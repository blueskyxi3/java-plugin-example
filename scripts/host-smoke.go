//go:build ignore

// Exercises the real host Runtime against a running, isolated Java service.
// Does not read or write the installed host registry or the host database.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"

	"ai-hub/common/config"
	"ai-hub/common/extensions"
	"ai-hub/controller"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	pluginURL := os.Getenv("JAVA_EXAMPLE_TEST_URL")
	if pluginURL == "" {
		pluginURL = "http://127.0.0.1:3013"
	}
	secret := os.Getenv("JAVA_EXAMPLE_HOST_SECRET")
	if len(secret) < 32 {
		return fmt.Errorf("JAVA_EXAMPLE_HOST_SECRET must contain at least 32 characters")
	}
	body, err := os.ReadFile("../java-plugin-example/plugin.json")
	if err != nil {
		return err
	}
	var manifest extensions.Manifest
	if err = json.Unmarshal(body, &manifest); err != nil {
		return err
	}
	directory, err := os.MkdirTemp("", "java-example-host-smoke-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	config.IsMasterNode = true
	registry := filepath.Join(directory, "registry.json")
	runtime := extensions.NewRuntime(registry)
	defer runtime.Shutdown()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	registration := extensions.Registration{
		Manifest: manifest, Mode: "external", URL: pluginURL, Secret: secret,
		HostURL: "http://localhost:3000",
	}
	if err = runtime.Install(registration); err != nil {
		return fmt.Errorf("install: %w", err)
	}
	if err = runtime.Change(manifest.ID, "enable"); err != nil {
		return fmt.Errorf("enable/manifest verification: %w", err)
	}
	if err = runtime.Bootstrap(ctx, manifest.ID, 123); err != nil {
		return fmt.Errorf("bootstrap: %w", err)
	}
	profiles := runtime.Enrich(ctx, 123)
	profile, ok := profiles[manifest.ID].(map[string]any)
	if !ok || profile["active"] != true || profile["module_admin"] != false {
		return fmt.Errorf("identity enrichment did not return an active non-admin profile")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		pluginURL+"/api/v1/self?tag=a%2Fb&tag=two&user_id=999", nil)
	if err != nil {
		return err
	}
	request.Header.Set(extensions.IdentityHeader, extensions.Identity(secret, manifest.ID, 123, request, "go-smoke"))
	response, err := runtime.Client.Do(request)
	if err != nil {
		return err
	}
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			UserID int `json:"user_id"`
		} `json:"data"`
	}
	decodeErr := json.NewDecoder(response.Body).Decode(&result)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || decodeErr != nil || !result.Success || result.Data.UserID != 123 {
		return fmt.Errorf("Go-signed request failed (HTTP %d)", response.StatusCode)
	}
	if err = verifyBridge(ctx, runtime); err != nil {
		return err
	}
	if err = runtime.ConfigureRuntime(ctx, manifest.ID, pluginURL, "http://updated.example:3000"); err != nil {
		return fmt.Errorf("runtime update: %w", err)
	}
	restored := extensions.NewRuntime("")
	defer restored.Shutdown()
	if err = restored.Restore(registry); err != nil {
		return fmt.Errorf("registry restore: %w", err)
	}
	if _, ok = restored.Active(manifest.ID, "user.identity.enrich"); !ok {
		return fmt.Errorf("external plugin did not become active after registry restore")
	}
	if err = restored.Change(manifest.ID, "disable"); err != nil {
		return err
	}
	if len(restored.Enrich(ctx, 123)) != 0 {
		return fmt.Errorf("disabled plugin still enriches identities")
	}
	fmt.Println("PASS: external manifest, bootstrap, enrichment, Go identity, real host bridge, internal-path isolation, runtime update, registry restore and disable")
	return nil
}

func verifyBridge(ctx context.Context, runtime *extensions.Runtime) error {
	// A trusted user context substitutes only the login middleware. The active
	// plugin handler, proxy, path isolation and signature issuer are real host code.
	extensions.Default = runtime
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", 123)
		c.Set("session_version", int64(1))
	})
	router.GET("/api/plugins", controller.ActiveExtensions)
	router.Any("/api/plugin-bridge/:plugin/*path", controller.ProxyExtension)
	server := httptest.NewServer(router)
	defer server.Close()
	for _, test := range []struct {
		path   string
		status int
	}{
		{"/api/plugins", 200},
		{"/api/plugin-bridge/java-example/api/v1/self?tag=a%2Fb&tag=two&user_id=999", 200},
		{"/api/plugin-bridge/java-example/assets/plugin.js", 200},
		{"/api/plugin-bridge/java-example/internal/manifest", 404},
	} {
		request, err := http.NewRequestWithContext(ctx, "GET", server.URL+test.path, nil)
		if err != nil {
			return err
		}
		request.Header.Set("X-AIHub-Identity", "browser-cannot-supply-identity")
		response, err := server.Client().Do(request)
		if err != nil {
			return err
		}
		var payload map[string]any
		if test.status == 200 && test.path != "/api/plugin-bridge/java-example/assets/plugin.js" {
			err = json.NewDecoder(response.Body).Decode(&payload)
		}
		response.Body.Close()
		if response.StatusCode != test.status || err != nil {
			return fmt.Errorf("host bridge %s: HTTP %d, expected %d", test.path, response.StatusCode, test.status)
		}
		if payload != nil && payload["success"] != true {
			return fmt.Errorf("host bridge returned an unsuccessful response")
		}
		if test.path == "/api/plugins" {
			rows, ok := payload["data"].([]any)
			if !ok || len(rows) != 1 {
				return fmt.Errorf("active plugin list missing Java plugin")
			}
		}
		if data, ok := payload["data"].(map[string]any); ok && data["user_id"] != float64(123) {
			return fmt.Errorf("host bridge did not preserve authenticated user ID")
		}
	}
	return nil
}
