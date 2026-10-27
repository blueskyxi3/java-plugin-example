package com.aihub.plugins.example;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
public class PluginController {
  private final HostRuntime runtime;
  private final String manifest;

  public record UserInput(JsonNode user_id) {}
  public record Profile(long user_id, boolean active, boolean module_admin,
                        String demo_role, String source) {}

  public PluginController(HostRuntime runtime, PluginProperties properties, ObjectMapper mapper) throws IOException {
    this.runtime = runtime;
    manifest = new ClassPathResource("plugin.json").getContentAsString(StandardCharsets.UTF_8);
    JsonNode json = mapper.readTree(manifest);
    if (!properties.id().equals(json.path("id").asText()) || json.path("sdk_version").asInt() != 2) {
      throw new IllegalStateException("内嵌插件清单与服务配置不一致");
    }
  }

  @GetMapping("/healthz")
  public Map<String, String> health() {
    return Map.of("status", "ok");
  }

  @GetMapping(value = "/internal/manifest", produces = MediaType.APPLICATION_JSON_VALUE)
  public String manifest() {
    return manifest;
  }

  @PostMapping("/internal/profile")
  public Profile profile(@RequestBody UserInput input) {
    return profileFor(validUser(input));
  }

  @PostMapping("/internal/bootstrap")
  public Map<String, Object> bootstrap(@RequestBody UserInput input) {
    validUser(input);
    return success(Map.of());
  }

  @GetMapping("/internal/runtime")
  public HostRuntime.Connection runtime() {
    return runtime.current();
  }

  @PutMapping("/internal/runtime")
  public HostRuntime.Connection updateRuntime(@RequestBody HostRuntime.Connection input) throws IOException {
    return runtime.update(input == null ? null : input.host_url());
  }

  @GetMapping("/api/v1/self")
  public Map<String, Object> self(HttpServletRequest request) {
    var identity = (IdentityVerifier.Identity) request.getAttribute(PluginAuthFilter.IDENTITY_ATTRIBUTE);
    return success(profileFor(identity.user_id()));
  }

  private static long validUser(UserInput input) {
    if (input == null || input.user_id() == null || !input.user_id().isIntegralNumber()
        || !input.user_id().canConvertToLong() || input.user_id().asLong() <= 0) {
      throw new IllegalArgumentException("user_id 必须为正整数");
    }
    return input.user_id().asLong();
  }

  private static Profile profileFor(long id) {
    return new Profile(id, true, false, "member", "spring-boot");
  }

  private static Map<String, Object> success(Object data) {
    return Map.of("success", true, "message", "", "data", data);
  }
}
