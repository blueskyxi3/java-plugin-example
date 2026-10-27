package com.aihub.plugins.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(PluginProperties.class)
public class PluginApplication {
  public static void main(String[] args) {
    SpringApplication.run(PluginApplication.class, args);
  }
}
