const STORAGE_KEY = "local-steroid-planner-v1";
const THEME_KEY = "local-steroid-planner-theme";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
document.documentElement.classList.toggle("standalone", Boolean(isStandalone));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // O app continua funcionando mesmo quando aberto direto por arquivo.
    });
  });
}

const form = document.querySelector("#plannerForm");
const compoundsEl = document.querySelector("#compounds");
const template = document.querySelector("#compoundTemplate");
const scheduleBody = document.querySelector("#scheduleBody");
const metricsEl = document.querySelector("#metrics");
const summaryText = document.querySelector("#summaryText");
const copyOutput = document.querySelector("#copyOutput");
const themeButtons = document.querySelectorAll(".theme-option");

let latestPlan = null;

const defaultData = {
  startDate: toDateInputValue(new Date()),
  durationDays: 28,
  intervalDays: 2,
  eventTime: "08:00",
  sites: [
    "Glúteo direito",
    "Glúteo esquerdo",
    "Vasto lateral direito",
    "Vasto lateral esquerdo"
  ].join("\n"),
  notes: "Conferir material, higiene e registrar qualquer reação.",
  compounds: [
    { name: "Masteron propionato", weeklyMg: 200, concentration: 100 },
    { name: "Testo enantato", weeklyMg: 250, concentration: 250 }
  ]
};

function toDateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function parseDateInput(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function weekday(date) {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(date);
}

function number(value, digits = 2) {
  return Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function volume(value) {
  const amount = Number(value);
  if (!amount) return number(0);
  if (Math.abs(amount) < 0.01) return number(amount, 4);
  if (Math.abs(amount) < 0.1) return number(amount, 3);
  return number(amount);
}

function addCompound(compound = {}) {
  const row = template.content.firstElementChild.cloneNode(true);
  row.querySelector(".compound-name").value = compound.name || "";
  row.querySelector(".compound-weekly").value = compound.weeklyMg ?? "";
  row.querySelector(".compound-concentration").value = compound.concentration ?? "";
  row.querySelector(".remove-compound").addEventListener("click", () => {
    row.remove();
    if (!compoundsEl.children.length) addCompound();
  });
  compoundsEl.appendChild(row);
}

function getFormData() {
  const compounds = [...compoundsEl.querySelectorAll(".compound-row")].map((row) => ({
    name: row.querySelector(".compound-name").value.trim(),
    weeklyMg: Number(row.querySelector(".compound-weekly").value),
    concentration: Number(row.querySelector(".compound-concentration").value)
  })).filter((item) => item.name && item.weeklyMg > 0 && item.concentration > 0);

  return {
    startDate: document.querySelector("#startDate").value,
    durationDays: Number(document.querySelector("#durationDays").value),
    intervalDays: Number(document.querySelector("#intervalDays").value),
    eventTime: document.querySelector("#eventTime").value,
    sites: document.querySelector("#sites").value,
    notes: document.querySelector("#notes").value.trim(),
    compounds
  };
}

function setFormData(data) {
  document.querySelector("#startDate").value = data.startDate || defaultData.startDate;
  document.querySelector("#durationDays").value = data.durationDays || defaultData.durationDays;
  document.querySelector("#intervalDays").value = data.intervalDays || defaultData.intervalDays;
  document.querySelector("#eventTime").value = data.eventTime || defaultData.eventTime;
  document.querySelector("#sites").value = data.sites || defaultData.sites;
  document.querySelector("#notes").value = data.notes || defaultData.notes;
  compoundsEl.innerHTML = "";
  (data.compounds?.length ? data.compounds : defaultData.compounds).forEach(addCompound);
}

function buildPlan(data) {
  if (!data.compounds.length) {
    throw new Error("Adicione pelo menos uma substância com dose semanal e concentração.");
  }

  const sites = data.sites.split(/\r?\n/)
    .map((site) => site.trim())
    .filter(Boolean);

  if (!sites.length) {
    throw new Error("Adicione pelo menos um local para o rodízio.");
  }

  const start = parseDateInput(data.startDate);
  const applications = [];
  const doses = data.compounds.map((compound) => {
    const mgPerApplication = compound.weeklyMg * data.intervalDays / 7;
    const mlPerApplication = mgPerApplication / compound.concentration;
    return { ...compound, mgPerApplication, mlPerApplication };
  });

  for (let day = 0, index = 0; day < data.durationDays; day += data.intervalDays, index += 1) {
    const date = new Date(start.getTime() + day * MS_PER_DAY);
    const totalMl = doses.reduce((sum, dose) => sum + dose.mlPerApplication, 0);
    applications.push({
      index: index + 1,
      date,
      site: sites[index % sites.length],
      doses,
      totalMl
    });
  }

  return { ...data, sites, doses, applications };
}

function renderPlan(plan) {
  const totalMl = plan.applications.reduce((sum, app) => sum + app.totalMl, 0);
  const totalMg = plan.doses.reduce((sum, dose) => {
    return sum + dose.mgPerApplication * plan.applications.length;
  }, 0);

  summaryText.textContent = `${plan.applications.length} aplicações em ${plan.durationDays} dias, com intervalo de ${plan.intervalDays} dia(s).`;
  metricsEl.innerHTML = [
    metric("Aplicações", plan.applications.length, "no período"),
    metric("Volume por aplicação", `${volume(plan.applications[0]?.totalMl || 0)} ml`, "soma das substâncias"),
    metric("Volume total", `${volume(totalMl)} ml`, `${number(totalMg, 1)} mg no período`)
  ].join("");

  scheduleBody.innerHTML = plan.applications.map((app) => `
    <tr>
      <td>${formatDate(app.date)}</td>
      <td>${weekday(app.date)}</td>
      <td>${escapeHtml(app.site)}</td>
      <td>${app.doses.map((dose) => `${escapeHtml(dose.name)}: ${number(dose.mgPerApplication, 1)} mg / ${volume(dose.mlPerApplication)} ml`).join("<br>")}</td>
      <td>${volume(app.totalMl)} ml</td>
    </tr>
  `).join("");

  copyOutput.value = buildPlainText(plan);
}

function metric(value, strong, label) {
  return `<div class="metric"><strong>${strong}</strong><span>${value} · ${label}</span></div>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function buildPlainText(plan) {
  const lines = [
    "PLANEJAMENTO DE APLICAÇÕES",
    "",
    `Início: ${formatDate(parseDateInput(plan.startDate))}`,
    `Duração: ${plan.durationDays} dias`,
    `Intervalo: a cada ${plan.intervalDays} dia(s)`,
    "",
    "Por aplicação:"
  ];

  plan.doses.forEach((dose) => {
    lines.push(`- ${dose.name}: ${number(dose.mgPerApplication, 1)} mg = ${volume(dose.mlPerApplication)} ml`);
  });

  lines.push(`- Total: ${volume(plan.applications[0]?.totalMl || 0)} ml`);
  lines.push("");
  lines.push("Calendário:");
  lines.push("");

  plan.applications.forEach((app) => {
    lines.push(`${formatDate(app.date)} - ${weekday(app.date)}`);
    app.doses.forEach((dose) => {
      lines.push(`Aplicação: ${dose.name}`);
      lines.push(`Dose: ${number(dose.mgPerApplication, 1)} mg`);
      lines.push(`Volume: ${volume(dose.mlPerApplication)} ml`);
    });
    lines.push(`Total: ${volume(app.totalMl)} ml`);
    lines.push(`Local: ${app.site}`);
    lines.push("");
  });

  if (plan.notes) {
    lines.push("");
    lines.push("Observações:");
    lines.push(plan.notes);
  }

  lines.push("");
  lines.push("Aviso: este planejamento apenas organiza informações inseridas por você e não substitui orientação médica.");
  return lines.join("\n");
}

function buildTaskText(plan) {
  return plan.applications.map((app) => {
    const doseText = app.doses.map((dose) => `${dose.name}: ${volume(dose.mlPerApplication)} ml`).join(" + ");
    return [
      `${formatDate(app.date)} - ${weekday(app.date)}`,
      `Aplicação: ${doseText}`,
      `Total: ${volume(app.totalMl)} ml`,
      `Local: ${app.site}`
    ].join("\n");
  }).join("\n\n");
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  URL.revokeObjectURL(url);
}

function makeFile(filename, content, type) {
  return new File([content], filename, { type });
}

async function shareFileOrDownload(filename, content, type, title, text) {
  const file = makeFile(filename, content, type);
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, text, files: [file] });
    return;
  }

  if (navigator.share) {
    await navigator.share({ title, text: text || content });
    return;
  }

  download(filename, content, type);
}

function selectCopyText(text) {
  copyOutput.value = text;
  copyOutput.removeAttribute("readonly");
  copyOutput.focus();
  copyOutput.select();
  copyOutput.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  copyOutput.setAttribute("readonly", "readonly");
  return copied;
}

function buildIcs(plan) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events = plan.applications.map((app) => {
    const [hour, minute] = plan.eventTime.split(":").map(Number);
    const start = new Date(app.date);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + 20 * 60000);
    const uid = `aplicacao-${app.index}-${start.getTime()}@planejador-local`;
    const desc = [
      ...app.doses.flatMap((dose) => [
        `Aplicação: ${dose.name}`,
        `Dose: ${number(dose.mgPerApplication, 1)} mg`,
        `Volume: ${volume(dose.mlPerApplication)} ml`
      ]),
      `Total: ${volume(app.totalMl)} ml`,
      `Local: ${app.site}`,
      plan.notes ? `Observações: ${plan.notes}` : ""
    ].filter(Boolean).join("\\n");

    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDate(start)}`,
      `DTEND:${toIcsDate(end)}`,
      "SUMMARY:Aplicação planejada",
      `DESCRIPTION:${escapeIcs(desc)}`,
      `LOCATION:${escapeIcs(app.site)}`,
      "END:VEVENT"
    ].join("\r\n");
  });

  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Planejador Local//PT-BR", ...events, "END:VCALENDAR"].join("\r\n");
}

function toIcsDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    pad(date.getMinutes()),
    "00"
  ].join("");
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function generate() {
  latestPlan = buildPlan(getFormData());
  renderPlan(latestPlan);
  return latestPlan;
}

function requirePlan() {
  if (!latestPlan) return generate();
  return latestPlan;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getFormData()));
}

function applyTheme(theme) {
  const selectedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selectedTheme;
  localStorage.setItem(THEME_KEY, selectedTheme);
  themeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === selectedTheme);
  });
}

document.querySelector("#addCompoundBtn").addEventListener("click", () => addCompound());

themeButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.theme));
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    generate();
    save();
  } catch (error) {
    alert(error.message);
  }
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  save();
  alert("Dados salvos neste navegador.");
});

document.querySelector("#clearBtn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  setFormData(defaultData);
  latestPlan = null;
  scheduleBody.innerHTML = '<tr><td colspan="5" class="empty">Nenhum planejamento gerado ainda.</td></tr>';
  metricsEl.innerHTML = "";
  copyOutput.value = "";
  summaryText.textContent = "Preencha os dados e gere a tabela.";
});

document.querySelector("#copyBtn").addEventListener("click", async () => {
  const plan = requirePlan();
  const text = buildPlainText(plan);
  copyOutput.value = text;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API indisponível");
    await navigator.clipboard.writeText(text);
    alert("Planejamento copiado.");
  } catch {
    const copied = selectCopyText(text);
    alert(copied ? "Planejamento copiado." : "Texto selecionado. Toque em Copiar no menu do celular.");
  }
});

document.querySelector("#icsBtn").addEventListener("click", async () => {
  const plan = requirePlan();
  try {
    await shareFileOrDownload(
      "planejamento-aplicacoes.ics",
      buildIcs(plan),
      "text/calendar",
      "Planejamento de aplicações",
      "Importe este arquivo no Calendário ou Google Agenda."
    );
  } catch (error) {
    if (error.name !== "AbortError") {
      download("planejamento-aplicacoes.ics", buildIcs(plan), "text/calendar;charset=utf-8");
    }
  }
});

document.querySelector("#tasksBtn").addEventListener("click", async () => {
  const plan = requirePlan();
  const text = buildTaskText(plan);
  try {
    await shareFileOrDownload(
      "tarefas-aplicacoes.txt",
      text,
      "text/plain",
      "Tarefas de aplicações",
      text
    );
  } catch (error) {
    if (error.name !== "AbortError") {
      download("tarefas-aplicacoes.txt", text, "text/plain;charset=utf-8");
    }
  }
});

document.querySelector("#pdfBtn").addEventListener("click", () => {
  requirePlan();
  window.print();
});

let savedData = defaultData;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  savedData = saved ? JSON.parse(saved) : defaultData;
} catch {
  localStorage.removeItem(STORAGE_KEY);
}
setFormData(savedData);
applyTheme(localStorage.getItem(THEME_KEY) || "light");
generate();
