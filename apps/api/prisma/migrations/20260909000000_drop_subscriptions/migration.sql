-- Nonprofit refactor: the platform no longer has subscriptions or payments.
-- Drops the table that mirrored Stripe subscription state and its two enums.
-- DROP TABLE removes the table's indexes and foreign key with it. The commercial
-- version of the schema is preserved at git tag pre-nonprofit-refactor.

DROP TABLE "subscriptions";
DROP TYPE "SubscriptionPlan";
DROP TYPE "SubscriptionStatus";
