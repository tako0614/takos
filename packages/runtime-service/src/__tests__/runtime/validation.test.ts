import { Buffer } from "node:buffer";

import {
  getWorkerResourceLimits,
  isProbablyBinary,
  isValidSessionId,
  validateCommand,
  validateCommandLine,
  validateGitAuthorEmail,
  validateGitAuthorName,
  validateGitName,
  validateGitPath,
  validateGitRef,
  validateNameParam,
  validateSpaceId,
} from "../../runtime/validation.ts";

import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";

Deno.test("validateCommandLine", () => {
  validateCommandLine("echo hello");
  assertThrows(() => validateCommandLine(""));
  assertThrows(() => validateCommandLine("   "));
  assertThrows(() => validateCommandLine("echo\u0000hello"));
  assertThrows(() => validateCommandLine("reboot"));
  assertThrows(() => validateCommandLine("shutdown -h now"));
  assertThrows(() => validateCommandLine(":() { : | : & }"));
  assertThrows(() => validateCommandLine("dd if=/dev/zero of=/dev/sda"));
});

Deno.test("isProbablyBinary", () => {
  assertEquals(isProbablyBinary(Buffer.alloc(0)), false);
  assertEquals(isProbablyBinary(Buffer.from([0x00, 0x41, 0x42])), true);
  assertEquals(
    isProbablyBinary(Buffer.from("Hello, world! This is normal text.")),
    false,
  );

  const buf = Buffer.alloc(100);
  for (let i = 0; i < 100; i++) {
    buf[i] = i % 3 === 0 ? 0x01 : 0x41;
  }
  assertEquals(isProbablyBinary(buf), true);
  assertEquals(
    isProbablyBinary(Buffer.from("Hello world with tab\there\n")),
    false,
  );
});

Deno.test("isValidSessionId", () => {
  assertEquals(isValidSessionId("abcdefghijklmnop"), true);
  assertEquals(isValidSessionId("abc-def_ghi-jklmnop"), true);
  assertEquals(isValidSessionId("abc"), false);
  assertEquals(isValidSessionId("-abcdefghijklmnop"), false);
  assertEquals(isValidSessionId("abcdefghijklmnop-"), false);
  assertEquals(isValidSessionId("abcdefg--hijklmnop"), false);
  assertEquals(isValidSessionId(123 as never), false);
  assertEquals(isValidSessionId(""), false);
});

Deno.test("getWorkerResourceLimits", () => {
  assertEquals(getWorkerResourceLimits(0), undefined);
  assertEquals(getWorkerResourceLimits(undefined), undefined);
  assertEquals(getWorkerResourceLimits(4), { maxOldGenerationSizeMb: 16 });
  assertEquals(getWorkerResourceLimits(1024), { maxOldGenerationSizeMb: 512 });
  assertEquals(getWorkerResourceLimits(256.7), { maxOldGenerationSizeMb: 256 });
  assertEquals(getWorkerResourceLimits(128), { maxOldGenerationSizeMb: 128 });
});

Deno.test("validateGitRef", () => {
  validateGitRef("main");
  validateGitRef("feature/new-thing");
  validateGitRef("abc123def456");
  validateGitRef("v1.0.0");

  assertThrows(() => validateGitRef(""));
  assertThrows(() => validateGitRef(".hidden"));
  assertThrows(() => validateGitRef("branch."));
  assertThrows(() => validateGitRef("branch..name"));
  assertThrows(() => validateGitRef("-flag"));
  assertThrows(() => validateGitRef("branch.lock"));
  assertThrows(() => validateGitRef(":ref"));
  assertThrows(() => validateGitRef("branch/"));
  assertThrows(() => validateGitRef("branch name"));
  assertThrows(() => validateGitRef("branch\\name"));
  assertThrows(() => validateGitRef("branch\u0001name"));
  assertThrows(() => validateGitRef("branch@{0}"));
  assertThrows(() => validateGitRef("a".repeat(257)));
});

Deno.test("validateGitPath", () => {
  validateGitPath("src/index.ts");
  validateGitPath("package.json");
  validateGitPath("");
  assertThrows(() => validateGitPath("../etc/passwd"));
  assertThrows(() => validateGitPath("/etc/passwd"));
  assertThrows(() => validateGitPath("C:\\Windows\\System32"));
  assertThrows(() => validateGitPath("file\u0000name"));
  assertThrows(() => validateGitPath("a".repeat(4097)));
  assertThrows(() => validateGitPath(123 as never));
});

Deno.test("validateGitAuthorName", () => {
  validateGitAuthorName("John Doe");
  assertThrows(() => validateGitAuthorName(""));
  assertThrows(() => validateGitAuthorName("John <script>"));
  assertThrows(() => validateGitAuthorName("John; rm -rf /"));
  assertThrows(() => validateGitAuthorName("a".repeat(257)));
  assertThrows(() => validateGitAuthorName("name\u0000test"));
});

Deno.test("validateGitAuthorEmail", () => {
  validateGitAuthorEmail("user@example.com");
  assertThrows(() => validateGitAuthorEmail(""));
  assertThrows(() => validateGitAuthorEmail("not-an-email"));
  assertThrows(() => validateGitAuthorEmail("a".repeat(260) + "@b.com"));
  assertThrows(() => validateGitAuthorEmail("user\u0000@test.com"));
});

Deno.test("validateGitName", () => {
  assertEquals(validateGitName("my-repo"), "my-repo");
  assertEquals(validateGitName("a"), "a");
  assertEquals(validateGitName("my_repo"), "my_repo");
  assertEquals(validateGitName(""), null);
  assertEquals(validateGitName("a".repeat(129)), null);
  assertEquals(validateGitName("../secret"), null);
  assertEquals(validateGitName("path/to/repo"), null);
  assertEquals(validateGitName("path\\to"), null);
  assertEquals(validateGitName("name\u0000evil"), null);
  assertEquals(validateGitName("%2e%2e"), null);
  assertEquals(validateGitName("my__repo"), null);
  assertEquals(validateGitName("my--repo"), null);
  assertEquals(validateGitName("_repo"), null);
  assertEquals(validateGitName("-repo"), null);
  assertEquals(validateGitName(null as never), null);
});

Deno.test("validateSpaceId", () => {
  assertEquals(validateSpaceId("ws123"), "ws123");
  assertEquals(validateSpaceId("my-workspace"), "my-workspace");
  assertThrows(() => validateSpaceId(""));
  assertThrows(() => validateSpaceId("!invalid"));
  assertThrows(() => validateSpaceId(null as never));
});

Deno.test("validateNameParam", () => {
  assertEquals(validateNameParam("my-repo", "repo"), null);
  assertEquals(validateNameParam(undefined, "repo"), "repo is required");
  assertEquals(validateNameParam("", "repo"), "repo is required");
  assertEquals(validateNameParam("!invalid", "repo"), "Invalid repo format");
});

Deno.test("validateCommand", () => {
  assertEquals(validateCommand("npm install"), null);
  assertEquals(validateCommand('git commit -m "message"'), null);
  assertEquals(validateCommand(""), "Command is empty or invalid");
  assertEquals(validateCommand("   "), "Command is empty or invalid");
  assertEquals(validateCommand("a".repeat(100001)), "Command is too long");

  const shellResult = validateCommand("echo hello | grep world");
  assertStringIncludes(shellResult ?? "", "shell metacharacters");

  const disallowedResult = validateCommand("python3 script.py");
  assertStringIncludes(disallowedResult ?? "", "Command not allowed");

  assertEquals(validateCommand("./my-script"), null);
  assertEquals(
    validateCommand("echo\u0001hello"),
    "Command contains invalid control characters",
  );
  assertEquals(validateCommand("# This is a comment\nnpm install"), null);

  const curlResult = validateCommand(
    "curl http://169.254.169.254/latest/meta-data/",
  );
  assertStringIncludes(curlResult ?? "", "dangerous patterns");

  const wgetResult = validateCommand(
    "wget http://metadata.google.internal/computeMetadata/v1/",
  );
  assertStringIncludes(wgetResult ?? "", "dangerous patterns");
});
