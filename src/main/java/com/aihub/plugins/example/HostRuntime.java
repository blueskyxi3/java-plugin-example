package com.aihub.plugins.example;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class HostRuntime {
  private final Path file;
  private final ObjectMapper mapper;
  private volatile String hostUrl;

  public record Connection(String host_url) {}

  public HostRuntime(PluginProperties properties, ObjectMapper mapper) throws IOException {
    this.mapper = mapper;
    Files.createDirectories(properties.dataDirectory());
    file = properties.dataDirectory().resolve("runtime.json");
    if (properties.hostBaseUrl() != null && !properties.hostBaseUrl().isBlank()) {
      hostUrl = validateOrigin(properties.hostBaseUrl());
    } else if (Files.exists(file)) {
      hostUrl = validateOrigin(mapper.readValue(Files.readAllBytes(file), Connection.class).host_url());
    } else {
      hostUrl = "http://localhost:3000";
    }
  }

  public Connection current() {
    return new Connection(hostUrl);
  }

  // Serialize writers and publish only after a successful atomic replacement.
  public synchronized Connection update(String value) throws IOException {
    String next = validateOrigin(value);
    if (next.equals(hostUrl)) {
      return current();
    }
    Path temporary = Files.createTempFile(file.getParent(), "runtime-", ".tmp");
    try {
      Files.write(temporary, mapper.writeValueAsBytes(new Connection(next)));
      Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } finally {
      Files.deleteIfExists(temporary);
    }
    hostUrl = next;
    return current();
  }

  public static String validateOrigin(String value) {
    try {
      if (value != null && value.length() <= 2048) {
        URI uri = new URI(value);
        String path = uri.getRawPath();
        if (("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
            && uri.getHost() != null && uri.getRawUserInfo() == null
            && uri.getRawQuery() == null && uri.getRawFragment() == null
            && (path == null || path.isEmpty() || path.equals("/"))
            && uri.getPort() >= -1 && uri.getPort() <= 65535) {
          return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
        }
      }
    } catch (URISyntaxException ignored) {
      // All invalid origins use the same safe public error.
    }
    throw new IllegalArgumentException("host_url 必须为不含路径、查询、片段或凭据的 HTTP/HTTPS origin");
  }
}
