//go:build ignore

// Run from the AI Hub repository root:
// go run ../java-plugin-example/scripts/go-sign-fixture.go > ../java-plugin-example/src/test/resources/go-sign-fixture.json
package main

import (
	"encoding/json"
	"os"

	"ai-hub/common/extensions"
)

func main() {
	const secret = "0123456789abcdef0123456789abcdef"
	claims := extensions.Claims{
		UserID: 123, PluginID: "java-example", Method: "GET",
		URI: "/api/v1/self?tag=a%2Fb&tag=two", RequestID: "req-go", ExpiresAt: 1791700030,
	}
	fixture := map[string]any{
		"secret": secret, "now": 1791700000, "claims": claims,
		"token": extensions.Sign(secret, claims),
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(fixture); err != nil {
		panic(err)
	}
}
