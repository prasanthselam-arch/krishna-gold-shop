import "dotenv/config";
import bcrypt from "bcryptjs";
import { DEFAULT_PASSWORD, audit, db } from "../server/db.ts";

const [username, password] = [process.env.RESET_USER || "owner", process.env.RESET_PASSWORD || ""];

if (password.length < 8 || password.length > 72) {
  console.error("Password must be 8 to 72 characters.");
  process.exit(2);
}

const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: number } | undefined;
if (!user) {
  const names = (db.prepare("SELECT username FROM users").all() as { username: string }[]).map((u) => u.username);
  console.error(`No user "${username}". Existing users: ${names.join(", ") || "none"}`);
  process.exit(3);
}

db.prepare("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(
  bcrypt.hashSync(password, 12),
  password === DEFAULT_PASSWORD ? 1 : 0,
  user.id,
);
audit(null, "reset_password", "user", user.id, { via: "run.sh" });
console.log(username);
