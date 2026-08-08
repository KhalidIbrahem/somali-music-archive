-- Educator role + phone login identifier (SESSION "teaching").
--
-- ALTER TYPE ... ADD VALUE is safe on a live enum: existing rows keep their
-- values and the new label becomes assignable immediately after commit.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'educator';

-- Optional E.164 phone number, usable as a login identifier. Nullable unique —
-- Postgres treats NULLs as distinct, so members without a phone are unaffected.
ALTER TABLE "users" ADD COLUMN "phone" TEXT;

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
