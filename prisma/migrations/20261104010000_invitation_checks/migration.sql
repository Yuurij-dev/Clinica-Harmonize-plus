-- Defesa em profundidade: o banco recusa e-mail fora da forma normalizada e papel
-- diferente de PROFESSIONAL/STAFF (ADMIN nunca e concedido por convite). Aditiva.
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "ClinicInvitation" ADD CONSTRAINT "ClinicInvitation_role_allowed_check" CHECK ("role" IN ('PROFESSIONAL', 'STAFF'));
