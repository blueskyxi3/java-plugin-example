package com.aihub.plugins.example;

import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class PluginErrors {
  private static final Logger log = LoggerFactory.getLogger(PluginErrors.class);

  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<?> invalid(IllegalArgumentException error) {
    return failure(400, "invalid_argument", error.getMessage());
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<?> malformed() {
    return failure(400, "invalid_json", "请求 JSON 无效");
  }

  @ExceptionHandler(IOException.class)
  public ResponseEntity<?> storage(IOException error) {
    log.error("Cannot persist plugin runtime configuration", error);
    return failure(500, "runtime_save_failed", "保存运行配置失败");
  }

  private static ResponseEntity<?> failure(int status, String code, String message) {
    return ResponseEntity.status(status).body(Map.of("success", false, "message", message, "code", code));
  }
}
