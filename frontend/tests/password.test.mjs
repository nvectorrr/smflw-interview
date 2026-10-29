import assert from "node:assert/strict";
import test from "node:test";
import { passwordChangeError } from "../src/lib/password.ts";

test("password changes require six characters and an exact confirmation", () => {
  assert.match(passwordChangeError("", ""), /at least 6/);
  assert.match(passwordChangeError("12345", "12345"), /at least 6/);
  assert.equal(passwordChangeError("123456", "123456"), "");
  assert.match(passwordChangeError("123456", "123457"), /do not match/);
  assert.match(passwordChangeError(" secret ", "secret"), /do not match/);
  assert.equal(passwordChangeError(" secret ", " secret "), "");
});
