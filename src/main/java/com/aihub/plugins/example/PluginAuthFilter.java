package com.aihub.plugins.example;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

@Component
public class PluginAuthFilter extends OncePerRequestFilter {
  public static final String IDENTITY_ATTRIBUTE = PluginAuthFilter.class.getName() + ".identity";
  private static final Logger log = LoggerFactory.getLogger(PluginAuthFilter.class);
  private final PluginProperties properties;
  private final IdentityVerifier verifier;
  private final HostRuntime runtime;
  private final ObjectMapper mapper;

  public PluginAuthFilter(PluginProperties properties, IdentityVerifier verifier,
                          HostRuntime runtime, ObjectMapper mapper) {
    this.properties = properties;
    this.verifier = verifier;
    this.runtime = runtime;
    this.mapper = mapper;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                  FilterChain chain) throws ServletException, IOException {
    String path = request.getServletPath();
    // Spring MVC can remove matrix parameters during matching. Reject aliases
    // before dispatch so a differently spelled path cannot skip authentication.
    if (request.getRequestURI().contains(";") || path.contains(";")) {
      reject(response, 400, "invalid_path", "请求路径无效");
      return;
    }
    if (path.equals("/internal") || path.startsWith("/internal/")) {
      String secret = request.getHeader("X-AIHub-Plugin-Secret");
      if (secret == null || !MessageDigest.isEqual(properties.hostSecret().getBytes(StandardCharsets.UTF_8),
          secret.getBytes(StandardCharsets.UTF_8))) {
        reject(response, 401, "invalid_service_secret", "插件服务凭据无效");
        return;
      }
      String callback = request.getHeader("X-AIHub-Host-Base-URL");
      if (callback != null && !callback.isEmpty()) {
        try {
          runtime.update(callback);
        } catch (IllegalArgumentException e) {
          reject(response, 400, "invalid_host_url", e.getMessage());
          return;
        } catch (IOException e) {
          log.error("Cannot persist host callback configuration", e);
          reject(response, 500, "runtime_save_failed", "保存运行配置失败");
          return;
        }
      }
    } else if (path.equals("/api/v1") || path.startsWith("/api/v1/")) {
      String uri = request.getRequestURI();
      if (request.getQueryString() != null) {
        uri += "?" + request.getQueryString();
      }
      try {
        request.setAttribute(IDENTITY_ATTRIBUTE,
            verifier.verify(request.getHeader("X-AIHub-Identity"), request.getMethod(), uri));
      } catch (IdentityVerifier.InvalidIdentityException e) {
        reject(response, 401, "invalid_identity", "宿主身份凭证无效或过期");
        return;
      }
      response.setHeader("Cache-Control", "no-store");
    }
    chain.doFilter(request, response);
  }

  private void reject(HttpServletResponse response, int status, String code, String message) throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    response.setCharacterEncoding("UTF-8");
    mapper.writeValue(response.getOutputStream(), Map.of("success", false, "code", code, "message", message));
  }
}
