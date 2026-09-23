-- Harmonize+ - schema PostgreSQL
-- Execute este arquivo no SQL Editor do Supabase ou de outro PostgreSQL.

create type "UserRole" as enum ('ADMIN', 'PROFESSIONAL', 'STAFF');

create table "User" (
  "id" text primary key,
  "name" text not null,
  "email" text not null unique,
  "passwordHash" text not null,
  "role" "UserRole" not null default 'ADMIN',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Clinic" (
  "id" text primary key,
  "name" text not null,
  "slug" text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "ClinicMembership" (
  "id" text primary key,
  "userId" text not null references "User"("id") on delete cascade,
  "clinicId" text not null references "Clinic"("id") on delete cascade,
  "role" "UserRole" not null default 'STAFF',
  unique ("userId", "clinicId")
);

create table "Patient" (
  "id" text primary key,
  "name" text not null,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "cpf" text,
  "phone" text not null,
  "age" integer not null,
  "status" text not null default 'Ativa',
  "lastVisit" timestamptz,
  "nextReturn" timestamptz,
  "totalValue" integer not null default 0,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Appointment" (
  "id" text primary key,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "date" timestamptz not null,
  "time" text not null,
  "patientId" text not null references "Patient"("id") on delete cascade,
  "procedure" text not null,
  "professional" text not null,
  "status" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Procedure" (
  "id" text primary key,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "name" text not null,
  "category" text not null,
  "price" integer not null,
  "durationMinutes" integer not null,
  "materials" text not null,
  "margin" double precision not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Evaluation" (
  "id" text primary key,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "patientId" text not null references "Patient"("id") on delete cascade,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Product" (
  "id" text primary key,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "name" text not null,
  "category" text not null,
  "unit" text not null,
  "cost" integer not null,
  "supplier" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Quote" (
  "id" text primary key,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "patientId" text references "Patient"("id") on delete set null,
  "items" text not null,
  "total" integer not null,
  "status" text not null default 'Pendente',
  "expires" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "Payment" (
  "id" text primary key,
  "clinicId" text references "Clinic"("id") on delete cascade,
  "patientId" text references "Patient"("id") on delete set null,
  "value" integer not null,
  "method" text not null,
  "date" timestamptz not null default now(),
  "status" text not null default 'Pago',
  "installments" text not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "EvaluationPhoto" (
  "id" text primary key,
  "evaluationId" text not null references "Evaluation"("id") on delete cascade,
  "name" text not null,
  "imageUrl" text not null,
  "width" integer not null,
  "height" integer not null,
  "annotations" text not null default '[]',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index "Appointment_patientId_date_idx" on "Appointment" ("patientId", "date");
create index "Patient_clinicId_idx" on "Patient" ("clinicId");
create index "Appointment_clinicId_idx" on "Appointment" ("clinicId");
create index "Procedure_clinicId_idx" on "Procedure" ("clinicId");
create index "Evaluation_clinicId_idx" on "Evaluation" ("clinicId");
create index "ClinicMembership_clinicId_idx" on "ClinicMembership" ("clinicId");
create unique index "Patient_clinicId_cpf_key" on "Patient" ("clinicId", "cpf");
create unique index "Procedure_clinicId_name_key" on "Procedure" ("clinicId", "name");
create index "Evaluation_patientId_idx" on "Evaluation" ("patientId");
create index "EvaluationPhoto_evaluationId_idx" on "EvaluationPhoto" ("evaluationId");
create index "Quote_clinicId_idx" on "Quote" ("clinicId");
create index "Quote_patientId_idx" on "Quote" ("patientId");
create index "Payment_clinicId_idx" on "Payment" ("clinicId");
create index "Payment_patientId_idx" on "Payment" ("patientId");
create index "Product_clinicId_idx" on "Product" ("clinicId");
create unique index "Product_clinicId_name_key" on "Product" ("clinicId", "name");

-- Execute this separately if the Patient table was created before CPF was added.
alter table "Patient" add column if not exists "cpf" text;

insert into "User" ("id", "name", "email", "passwordHash", "role")
values (
  'admin-user',
  'Dra. Ana',
  'admin',
  '$2b$12$Pcss9e9V3IoqLJczBEX6vemHQ4/kxU770jR88/Gvn9FIlNDXEpxJO',
  'ADMIN'
)
on conflict ("email") do nothing;

insert into "Clinic" ("id", "name", "slug")
values ('clinic-demo', 'Clínica Harmonize', 'harmonize-demo')
on conflict ("slug") do nothing;

insert into "ClinicMembership" ("id", "userId", "clinicId", "role")
select 'membership-admin-demo', "id", 'clinic-demo', 'ADMIN'
from "User" where "email" = 'admin'
on conflict ("userId", "clinicId") do nothing;
