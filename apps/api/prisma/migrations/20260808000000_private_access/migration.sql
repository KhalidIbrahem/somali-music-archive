-- Private access (SESSION "private access"): usernames + invite-only registration.

-- Unique lowercase handle; nullable so pre-username accounts keep email/phone login.
ALTER TABLE "users" ADD COLUMN "username" TEXT;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE TABLE "invite_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes"("code");
CREATE INDEX "invite_codes_created_by_id_idx" ON "invite_codes"("created_by_id");

CREATE TABLE "invite_redemptions" (
    "id" UUID NOT NULL,
    "code_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "redeemed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invite_redemptions_code_id_user_id_key" ON "invite_redemptions"("code_id", "user_id");
CREATE INDEX "invite_redemptions_user_id_idx" ON "invite_redemptions"("user_id");

ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_code_id_fkey"
  FOREIGN KEY ("code_id") REFERENCES "invite_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
