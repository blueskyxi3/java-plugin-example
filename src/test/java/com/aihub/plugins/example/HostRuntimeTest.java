package com.aihub.plugins.example;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.json.JsonMapper;

class HostRuntimeTest {
  @TempDir Path directory;

  private HostRuntime runtime(String override) throws IOException {
    return new HostRuntime(new PluginProperties("java-example", IdentityVerifierTest.SECRET, override, directory),
        JsonMapper.builder().build());
  }

  @Test
  void persistsRestoresAndRespectsStartupOverride() throws IOException {
    HostRuntime service = runtime("");
    assertEquals("http://localhost:3000", service.current().host_url());
    assertEquals("https://hub.example:8443", service.update("https://hub.example:8443/").host_url());
    assertEquals("https://hub.example:8443", runtime("").current().host_url());
    assertEquals("http://override.example", runtime("http://override.example").current().host_url());
    assertEquals("https://hub.example:8443", runtime("").current().host_url());
  }

  @Test
  void rejectsInvalidOriginsWithoutChangingState() throws IOException {
    HostRuntime service = runtime("");
    for (String url : new String[] {"", "ftp://hub.example", "https://hub.example/api", "https://u:p@hub.example",
        "https://hub.example?x=1", "https://hub.example#frag", "//hub.example", "https://", "https://hub.example:70000"}) {
      assertThrows(IllegalArgumentException.class, () -> service.update(url), url);
      assertEquals("http://localhost:3000", service.current().host_url());
    }
    assertThrows(IllegalArgumentException.class, () -> service.update(null));
    assertFalse(Files.exists(directory.resolve("runtime.json")));
  }

  @Test
  void failedAtomicReplacementDoesNotPublishNewState() throws IOException {
    HostRuntime service = runtime("");
    Path blocker = directory.resolve("runtime.json");
    Files.createDirectory(blocker);
    Files.writeString(blocker.resolve("keep"), "block replacement");
    assertThrows(IOException.class, () -> service.update("https://next.example"));
    assertEquals("http://localhost:3000", service.current().host_url());
    try (var paths = Files.list(directory)) {
      assertEquals(1, paths.count(), "temporary files must be cleaned up");
    }
  }

  @Test
  void serializesConcurrentUpdatesAndRestartsWithLastPublishedValue() throws Exception {
    HostRuntime service = runtime("");
    try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
      var updates = new ArrayList<Callable<HostRuntime.Connection>>();
      for (int i = 0; i < 30; i++) {
        String url = "https://hub-" + i + ".example";
        updates.add(() -> service.update(url));
      }
      for (var result : pool.invokeAll(updates)) {
        assertNotNull(result.get());
      }
    }
    assertEquals(service.current(), runtime("").current());
  }
}
