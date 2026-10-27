package com.aihub.plugins.example;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("plugin")
public record PluginProperties(String id, String hostSecret, String hostBaseUrl, Path dataDirectory) {
  public PluginProperties {
    if (!"java-example".equals(id)) {
      throw new IllegalArgumentException("插件 ID 必须与 plugin.json 中的 java-example 一致");
    }
    if (hostSecret == null || hostSecret.length() < 32) {
      throw new IllegalArgumentException("JAVA_EXAMPLE_HOST_SECRET 必须至少为 32 个字符");
    }
    if (dataDirectory == null) {
      throw new IllegalArgumentException("必须提供插件数据目录");
    }
  }
}
