export function requireCreatedPatient(response, name, context = "reportsUi") {
  const patient = response?.data?.patient;
  if (response?.status === 201 && typeof patient?.id === "string" && patient.id) return patient;
  const message = typeof response?.data?.message === "string"
    ? response.data.message
    : typeof response?.data?.error === "string"
      ? response.data.error
      : "a resposta nao trouxe patient.id";
  throw new Error(context + ": POST /api/patients falhou para " + JSON.stringify(name) + " (" + (response?.status ?? "sem resposta") + "): " + message);
}
