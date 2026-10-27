package com.aihub.plugins.example;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class IdentityVerifierTest {
  static final String SECRET = "0123456789abcdef0123456789abcdef";
  static final long NOW = 1791700000L;
  private final IdentityVerifier verifier = new IdentityVerifier(
      new PluginProperties("java-example", SECRET, "", Path.of("data")), JsonMapper.builder().build(),
      Clock.fixed(Instant.ofEpochSecond(NOW), ZoneOffset.UTC));

  static String sign(String json) throws Exception {
    String body = Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return body + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(
        mac.doFinal(body.getBytes(StandardCharsets.US_ASCII)));
  }

  static String claims(long user, String plugin, String method, String uri, long expiry) {
    return "{\"user_id\":" + user + ",\"plugin_id\":\"" + plugin + "\",\"method\":\"" + method
        + "\",\"uri\":\"" + uri + "\",\"request_id\":\"req-java\",\"expires_at\":" + expiry + "}";
  }

  @Test
  void acceptsFixtureGeneratedByTheActualGoHostSigner() throws Exception {
    var mapper = JsonMapper.builder().build();
    try (var input = getClass().getResourceAsStream("/go-sign-fixture.json")) {
      assertNotNull(input);
      var fixture = mapper.readTree(input);
      assertEquals(SECRET, fixture.path("secret").asText());
      assertEquals(NOW, fixture.path("now").asLong());
      var claims = fixture.path("claims");
      var identity = verifier.verify(fixture.path("token").asText(),
          claims.path("method").asText(), claims.path("uri").asText());
      assertEquals(claims.path("user_id").asLong(), identity.user_id());
      assertEquals("req-go", identity.request_id());
    }
  }

  @Test
  void acceptsGoCompatibleClaimsAndExactExpiryBoundaries() throws Exception {
    for (long expiry : new long[] {NOW + 1, NOW + 30, NOW + 60}) {
      String token = sign(claims(123, "java-example", "GET", "/api/v1/self?tag=a%2Fb&tag=two", expiry));
      assertEquals(123, verifier.verify(token, "GET", "/api/v1/self?tag=a%2Fb&tag=two").user_id());
    }
  }

  @Test
  void rejectsTamperingAndEveryBoundClaim() throws Exception {
    String valid = sign(claims(123, "java-example", "GET", "/api/v1/self", NOW + 30));
    String signature = valid.substring(valid.indexOf('.'));
    String changedBody = sign(claims(1, "java-example", "GET", "/api/v1/self", NOW + 30)).split("\\.")[0];
    assertThrows(IdentityVerifier.InvalidIdentityException.class,
        () -> verifier.verify(changedBody + signature, "GET", "/api/v1/self"));
    for (String json : new String[] {
        claims(0, "java-example", "GET", "/api/v1/self", NOW + 30),
        claims(-1, "java-example", "GET", "/api/v1/self", NOW + 30),
        claims(123, "organization", "GET", "/api/v1/self", NOW + 30),
        claims(123, "java-example", "POST", "/api/v1/self", NOW + 30),
        claims(123, "java-example", "GET", "/api/v1/self?x=1", NOW + 30),
        claims(123, "java-example", "GET", "/api/v1/self", NOW),
        claims(123, "java-example", "GET", "/api/v1/self", NOW - 1),
        claims(123, "java-example", "GET", "/api/v1/self", NOW + 61),
        "not json", "null", "{}"
    }) {
      String token = sign(json);
      assertThrows(IdentityVerifier.InvalidIdentityException.class,
          () -> verifier.verify(token, "GET", "/api/v1/self"), json);
    }
  }

  @Test
  void rejectsMalformedAndMissingTokensAndConfiguration() {
    for (String token : new String[] {null, "", "a", "a.b.c", ".", "!.x", "a.%%%", "a.b=", "x".repeat(17000)}) {
      assertThrows(IdentityVerifier.InvalidIdentityException.class,
          () -> verifier.verify(token, "GET", "/api/v1/self"));
    }
    for (String secret : new String[] {null, "", "short"}) {
      assertThrows(IllegalArgumentException.class,
          () -> new PluginProperties("java-example", secret, "", Path.of("data")));
    }
    assertThrows(IllegalArgumentException.class,
        () -> new PluginProperties("organization", SECRET, "", Path.of("data")));
  }
}
