package com.aihub.plugins.example;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PluginHttpTest {
  @LocalServerPort int port;
  static final Path DATA = temporaryDirectory();
  final HttpClient client = HttpClient.newHttpClient();
  final JsonMapper mapper = JsonMapper.builder().build();

  private static Path temporaryDirectory() {
    try {
      return Files.createTempDirectory("java-example-http-");
    } catch (java.io.IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  @DynamicPropertySource
  static void config(DynamicPropertyRegistry registry) {
    registry.add("plugin.host-secret", () -> IdentityVerifierTest.SECRET);
    registry.add("plugin.host-base-url", () -> "http://localhost:3000");
    registry.add("plugin.data-directory", () -> DATA.toString());
  }

  HttpResponse<String> send(String method, String path, String body, String... headers) throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
        .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
    if (body != null) request.header("Content-Type", "application/json");
    for (int i = 0; i < headers.length; i += 2) request.header(headers[i], headers[i + 1]);
    return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  HttpResponse<String> internal(String method, String path, String body) throws Exception {
    return send(method, path, body, "X-AIHub-Plugin-Secret", IdentityVerifierTest.SECRET);
  }

  @Test
  void internalRoutesRequireSecretBeforeReadingOrApplyingCallback() throws Exception {
    for (String path : new String[] {"/internal/manifest", "/internal/profile", "/internal/bootstrap", "/internal/runtime"}) {
      assertEquals(401, send("GET", path, null).statusCode(), path);
      assertEquals(401, send("POST", path, "{}", "X-AIHub-Plugin-Secret", "wrong").statusCode(), path);
    }
    String before = internal("GET", "/internal/runtime", null).body();
    assertEquals(401, send("GET", "/internal/manifest", null,
        "X-AIHub-Host-Base-URL", "https://attacker.example").statusCode());
    assertEquals(before, internal("GET", "/internal/runtime", null).body());
  }

  @Test
  void manifestMatchesCatalogAndFrontendModuleIsPublic() throws Exception {
    var response = internal("GET", "/internal/manifest", null);
    assertEquals(200, response.statusCode());
    JsonNode manifest = mapper.readTree(response.body());
    try (var input = getClass().getResourceAsStream("/catalog.example.json")) {
      var catalog = mapper.readTree(input);
      assertEquals(catalog.get("manifest"), manifest);
      assertEquals(mapper.readTree("[\"external\"]"), catalog.get("modes"));
    }
    assertFalse(manifest.has("success"));
    var asset = send("GET", "/assets/plugin.js", null);
    assertEquals(200, asset.statusCode());
    assertTrue(asset.headers().firstValue("Content-Type").orElse("").contains("javascript"));
    assertTrue(asset.body().contains("AIHubPluginSDK"));
    try (var input = getClass().getResourceAsStream("/assets/plugin.js")) {
      assertEquals(new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8), asset.body());
    }
    assertFalse(asset.body().contains(IdentityVerifierTest.SECRET));
    assertEquals(200, send("GET", "/healthz", null).statusCode());
  }

  @Test
  void profileIsRawAndBootstrapIsIdempotentWithoutGrantingPermissions() throws Exception {
    var response = internal("POST", "/internal/profile", "{\"user_id\":123}");
    assertEquals(200, response.statusCode());
    var profile = mapper.readTree(response.body());
    assertEquals(123, profile.get("user_id").asInt());
    assertTrue(profile.get("active").asBoolean());
    assertFalse(profile.get("module_admin").asBoolean());
    assertFalse(profile.has("module_permissions"));
    assertFalse(profile.has("success"));
    String first = internal("POST", "/internal/bootstrap", "{\"user_id\":123}").body();
    assertEquals(first, internal("POST", "/internal/bootstrap", "{\"user_id\":123}").body());
    for (String body : new String[] {"{}", "null", "{\"user_id\":0}", "{\"user_id\":-1}",
        "{\"user_id\":1.5}", "{\"user_id\":\"123\"}", "{\"user_id\":9223372036854775808}", "{bad json"}) {
      assertEquals(400, internal("POST", "/internal/profile", body).statusCode());
      assertEquals(400, internal("POST", "/internal/bootstrap", body).statusCode());
    }
  }

  @Test
  void bindsIdentityToActualRawUriAndIgnoresBrowserUserId() throws Exception {
    String path = "/api/v1/self?tag=a%2Fb&tag=two&space=a+b&user_id=999";
    String token = IdentityVerifierTest.sign(IdentityVerifierTest.claims(123, "java-example", "GET", path,
        Instant.now().getEpochSecond() + 30));
    var response = send("GET", path, null, "X-AIHub-Identity", token);
    assertEquals(200, response.statusCode(), response.body());
    assertEquals(123, mapper.readTree(response.body()).path("data").path("user_id").asInt());
    assertEquals("no-store", response.headers().firstValue("Cache-Control").orElse(""));
    for (String changed : new String[] {"/api/v1/self", path.replace("%2F", "%2f"), path.replace("tag=two", "tag=other")}) {
      assertEquals(401, send("GET", changed, null, "X-AIHub-Identity", token).statusCode());
    }
    assertEquals(401, send("POST", path, "{}", "X-AIHub-Identity", token).statusCode());
    assertEquals(401, send("GET", path, null).statusCode());
    assertEquals(401, send("GET", path, null, "X-AIHub-Plugin-Secret", IdentityVerifierTest.SECRET).statusCode());
  }

  @Test
  void matrixParameterAliasesCannotBypassAuthentication() throws Exception {
    for (String path : new String[] {"/internal;ignored/manifest", "/internal;ignored/runtime", "/api;ignored/v1/self"}) {
      int status = send("GET", path, null).statusCode();
      assertTrue(status == 400 || status == 401 || status == 404, path + ": " + status);
    }
  }

  @Test
  void runtimeCanBeUpdatedAndSynchronizedOnlyAfterAuthentication() throws Exception {
    var changed = internal("PUT", "/internal/runtime", "{\"host_url\":\"https://updated.example/\"}");
    assertEquals(200, changed.statusCode());
    assertEquals("https://updated.example", mapper.readTree(changed.body()).path("host_url").asText());
    assertEquals(400, internal("PUT", "/internal/runtime", "{\"host_url\":\"https://hub.example/path\"}").statusCode());
    assertEquals(changed.body(), internal("GET", "/internal/runtime", null).body());
    assertEquals(200, send("GET", "/internal/manifest", null,
        "X-AIHub-Plugin-Secret", IdentityVerifierTest.SECRET,
        "X-AIHub-Host-Base-URL", "http://synchronized.example:3000").statusCode());
    assertEquals("http://synchronized.example:3000",
        mapper.readTree(internal("GET", "/internal/runtime", null).body()).path("host_url").asText());
    assertTrue(Files.readString(DATA.resolve("runtime.json")).contains("synchronized.example"));
  }
}
