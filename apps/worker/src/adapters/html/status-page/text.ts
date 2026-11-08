import type { HistoryRange, OverallStatus, PublicComponent, PublicIncidentUpdate, StatusLanguage } from "@tiny-uptime/contracts";

export type Count = "up" | "degraded" | "down" | "maintenance";
export const COUNTS: Count[] = ["up", "degraded", "down", "maintenance"];

/** Every word the page shows, per language. */
export type Text = {
  currentStatus: (title: string) => string;
  feedTitle: (title: string) => string;
  visitSite: string;
  pastIncidents: string;
  noIncidents: (days: number) => string;
  updated: string;
  poweredBy: string;
  banner: Record<OverallStatus, string>;
  state: Record<PublicComponent["status"], string>;
  range: string;
  zonePicker: string;
  counts: Record<Count, string>;
  services: (n: number) => string;
  localTime: string;
  daysIn: (zone: string) => string;
  rangeLabel: (days: HistoryRange) => string;
  ago: (n: number, size: "day" | "hour") => string;
  now: (size: "day" | "hour") => string;
  uptime: string;
  uptimeOver: (name: string, share: string, n: number, size: "day" | "hour") => string;
  noData: string;
  checks: (share: string, n: number) => string;
  avgMs: (ms: number) => string;
  slowShort: string;
  hoursOf: (name: string) => string;
  openBar: string;
  noBarIncidents: (size: "day" | "hour") => string;
  closeBar: string;
  since: string;
  lasted: string;
  slow: string;
  maintenanceNow: string;
  maintenanceLater: string;
  update: Record<PublicIncidentUpdate["status"], string>;
};

export const TEXT: Record<StatusLanguage, Text> = {
  en: {
    currentStatus: (title) => `Current status of ${title}`,
    feedTitle: (title) => `${title} incidents`,
    visitSite: "Visit site",
    pastIncidents: "Past incidents",
    noIncidents: (days) => (days === 1 ? "No incidents in the last day." : `No incidents in the last ${days} days.`),
    updated: "Updated",
    poweredBy: "Powered by",
    banner: {
      operational: "All systems operational",
      degraded: "Some systems are slow",
      partial_outage: "Partial outage",
      major_outage: "Major outage",
      maintenance: "Scheduled maintenance in progress",
    },
    state: { up: "Operational", degraded: "Slow", down: "Down", pending: "Checking", paused: "Paused" },
    range: "History",
    zonePicker: "Time zone",
    counts: { up: "Operational", degraded: "Slow", down: "Down", maintenance: "In maintenance" },
    services: (n) => (n === 1 ? "1 service" : `${n} services`),
    localTime: "Local time",
    daysIn: (zone) => `Each bar is a day in ${zone}.`,
    rangeLabel: (days) => (days === 1 ? "24 hours" : `${days} days`),
    ago: (n, size) => `${n} ${size === "hour" ? "hours" : "days"} ago`,
    now: (size) => (size === "hour" ? "Now" : "Today"),
    uptime: "uptime",
    uptimeOver: (name, share, n, size) => `${name}: ${share} uptime over the last ${n} ${size === "hour" ? "hours" : "days"}`,
    noData: "No data",
    checks: (share, n) => `${share} uptime, ${n} checks`,
    avgMs: (ms) => `${ms} ms average`,
    slowShort: "slow",
    hoursOf: (name) => `${name}, hour by hour`,
    openBar: "Show incidents",
    noBarIncidents: (size) => (size === "hour" ? "No incidents in this hour." : "No incidents on this day."),
    closeBar: "Back to all incidents",
    since: "Since",
    lasted: "lasted",
    slow: "slow responses",
    maintenanceNow: "Maintenance in progress",
    maintenanceLater: "Scheduled maintenance",
    update: { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved", update: "Update" },
  },
  es: {
    currentStatus: (title) => `Estado actual de ${title}`,
    feedTitle: (title) => `Incidentes de ${title}`,
    visitSite: "Ir al sitio",
    pastIncidents: "Incidentes anteriores",
    noIncidents: (days) => (days === 1 ? "Sin incidentes en el último día." : `Sin incidentes en los últimos ${days} días.`),
    updated: "Actualizado",
    poweredBy: "Hecho con",
    banner: {
      operational: "Todos los sistemas funcionan",
      degraded: "Algunos sistemas van lentos",
      partial_outage: "Falla parcial",
      major_outage: "Falla general",
      maintenance: "Mantenimiento programado en curso",
    },
    state: { up: "Funciona", degraded: "Lento", down: "Caído", pending: "Revisando", paused: "En pausa" },
    range: "Historial",
    zonePicker: "Zona horaria",
    counts: { up: "Operativos", degraded: "Lentos", down: "Caídos", maintenance: "En mantenimiento" },
    services: (n) => (n === 1 ? "1 servicio" : `${n} servicios`),
    localTime: "Hora local",
    daysIn: (zone) => `Cada barra es un día en hora ${zone}.`,
    rangeLabel: (days) => (days === 1 ? "24 horas" : `${days} días`),
    ago: (n, size) => `Hace ${n} ${size === "hour" ? "horas" : "días"}`,
    now: (size) => (size === "hour" ? "Ahora" : "Hoy"),
    uptime: "disponible",
    uptimeOver: (name, share, n, size) =>
      `${name}: ${share} disponible en ${size === "hour" ? "las últimas" : "los últimos"} ${n} ${size === "hour" ? "horas" : "días"}`,
    noData: "Sin datos",
    checks: (share, n) => `${share} disponible, ${n} revisiones`,
    avgMs: (ms) => `${ms} ms en promedio`,
    slowShort: "lento",
    hoursOf: (name) => `${name}, hora por hora`,
    openBar: "Ver incidentes",
    noBarIncidents: (size) => (size === "hour" ? "Sin incidentes en esta hora." : "Sin incidentes este día."),
    closeBar: "Volver a todos los incidentes",
    since: "Desde el",
    lasted: "duró",
    slow: "respuestas lentas",
    maintenanceNow: "Mantenimiento en curso",
    maintenanceLater: "Mantenimiento programado",
    update: {
      investigating: "Investigando",
      identified: "Identificado",
      monitoring: "En observación",
      resolved: "Resuelto",
      update: "Novedad",
    },
  },
};
