package com.aihub.plugins.example;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class IdentityVerifier {
  private final PluginProperties properties;
  private final ObjectMapper mapper;
  private final Clock clock;

  public record Identity(long user_id, String plugin_id, String method, String uri,
                         String request_id, long expires_at) {}

  @Autowired
  public IdentityVerifier(PluginProperties properties, ObjectMapper mapper) {
    this(properties, mapper, Clock.systemUTC());
  }

  IdentityVerifier(PluginProperties properties, ObjectMapper mapper, Clock clock) {
    this.properties = properties;
    this.mapper = mapper;
    this.clock = clock;
  }

  public Identity verify(String token, String method, String uri) {
    try {
      if (token == null || token.length() > 16384) {
        throw new IllegalArgumentException();
      }
      String[] parts = token.split("\\.", -1);
      if (parts.length != 2 || !parts[0].matches("[A-Za-z0-9_-]+")
          || !parts[1].matches("[A-Za-z0-9_-]+")) {
        throw new IllegalArgumentException();
      }
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(properties.hostSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] signature = Base64.getUrlDecoder().decode(parts[1]);
      if (!MessageDigest.isEqual(mac.doFinal(parts[0].getBytes(StandardCharsets.US_ASCII)), signature)) {
        throw new IllegalArgumentException();
      }
      Identity identity = mapper.readValue(Base64.getUrlDecoder().decode(parts[0]), Identity.class);
      long now = clock.instant().getEpochSecond();
      if (identity == null || identity.user_id() <= 0 || !properties.id().equals(identity.plugin_id())
          || !method.equals(identity.method()) || !uri.equals(identity.uri())
          || identity.expires_at() <= now || identity.expires_at() > now + 60) {
        throw new IllegalArgumentException();
      }
      return identity;
    } catch (IllegalArgumentException | tools.jackson.core.JacksonException e) {
      throw new InvalidIdentityException();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("HMAC-SHA256 不可用", e);
    }
  }

  public static class InvalidIdentityException extends RuntimeException {}
}
