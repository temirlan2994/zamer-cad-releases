import { describeSurveyRecord, measureSurveyContour, normalizeSurveyRecord, surveyKinds, surveyMaxPhotoBytes, surveyMaxTotalPhotoBytes, surveyNumber, surveyOpeningTypes, surveyPointTypes, surveyPositionKeys, surveyPresets } from "./survey.js";
import { parseLineDecimal } from "./line-input.js";
import { addNumericStepper } from "./numeric-stepper.js";

function element(kind, text, className) {
  const node = document.createElement(kind);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(label, handler, className) {
  const control = element("button", label, className);
  control.type = "button";
  control.addEventListener("click", handler);
  return control;
}

function labelControl(label, control) {
  const wrapper = element("label", "", "survey-field");
  wrapper.append(element("span", label), control);
  return wrapper;
}

function input(name, value = "", attributes = {}) {
  const control = document.createElement("input");
  control.name = name;
  control.value = value ?? "";
  for (const [key, attribute] of Object.entries(attributes)) control.setAttribute(key, attribute);
  return control;
}

function select(name, options, value) {
  const control = element("select");
  control.name = name;
  for (const [key, label] of options) control.add(new Option(label, key));
  control.value = value;
  return control;
}

function textarea(name, value, max) {
  const control = element("textarea");
  control.name = name;
  control.value = value || "";
  control.maxLength = max;
  control.rows = 2;
  return control;
}

function fieldValues(form) {
  return new FormData(form);
}

async function compressPhoto(file) {
  if (!/^image\/(?:jpeg|png|webp)$/.test(file.type) || file.size > 16_000_000) {
    throw new Error("Выберите JPEG, PNG или WebP до 16 МБ");
  }
  const image = await createImageBitmap(file);
  try {
    const canvas = element("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    for (const limit of [960, 760, 560, 400]) {
      const scale = Math.min(1, limit / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL("image/jpeg", 0.74);
      if (photo.length <= surveyMaxPhotoBytes) return photo;
    }
    throw new Error("Фото слишком большое для проекта");
  } finally {
    image.close();
  }
}

export function bindSurveyPanel(dialog, actions) {
  const title = dialog.querySelector("h2");
  const content = dialog.querySelector(".survey-content");
  const closeButton = dialog.querySelector("[data-survey-close]");

  function numericField(label, control) {
    const wrapper = element("div", "", "survey-field");
    const field = element("div", "", "numeric-stepper-field");
    control.setAttribute("aria-label", label);
    field.append(control);
    wrapper.append(element("span", label), field);
    addNumericStepper(control, { getStep: actions.numericStep });
    return wrapper;
  }
  let draft = null;
  let laser = null;

  function display(heading, nodes) {
    title.textContent = heading;
    content.replaceChildren(...nodes);
    if (!dialog.open) dialog.showModal();
    content.scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  function formWithFooter(handler, label = "Сохранить") {
    const form = element("form", "", "survey-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      handler(fieldValues(form));
    });
    const submit = element("button", label, "survey-primary");
    submit.type = "submit";
    const footer = element("div", "", "survey-action-row");
    footer.append(button("К списку", showList), submit);
    return {form, footer};
  }

  function showPassport() {
    const {survey} = actions.context();
    const {form, footer} = formWithFooter((fields) => {
      actions.savePassport(Object.fromEntries(fields));
      showList();
    });
    form.append(
      labelControl("Объект", input("site", survey.site, { maxlength: 150 })),
      labelControl("Дата визита", input("visitDate", survey.visitDate, { type: "date" })),
      labelControl("Исполнитель", input("operator", survey.operator, { maxlength: 100 })),
      labelControl("Базовый уровень для высот", input("datum", survey.datum, { maxlength: 100, required: "" })),
      numericField("Порог проверки замеров, мм", input("tolerance", survey.tolerance, { type: "number", step: "any", min: 0, max: 1e9, inputmode: "decimal", required: "" })), footer,
    );
    display("Паспорт замера", [form]);
  }

  function showRoom(edit) {
    const {room} = actions.context();
    const profiles = Object.entries(surveyPresets).map(([id, preset]) => [id, preset.label]);
    const {form, footer} = formWithFooter((fields) => {
      const name = String(fields.get("name")).trim();
      if (!name) return;
      actions.saveRoom({name, preset: fields.get("preset")}, edit);
      showList();
    }, edit ? "Сохранить" : "Создать");
    form.append(labelControl("Название помещения", input("name", edit ? room.name : "", { maxlength: 100, required: "" })),
      labelControl("Набор полей", select("preset", profiles, edit ? room.preset : "general")), footer);
    display(edit ? "Помещение" : "Новое помещение", [form]);
  }

  function showList() {
    draft = null;
    const {survey, room, entities, name} = actions.context();
    const subtitle = element("p", [survey.site || name, survey.visitDate].filter(Boolean).join(" · "), "survey-subtitle");
    const roomToggle = select("room", survey.rooms.map((item) => [item.id, item.name]), room.id);
    roomToggle.addEventListener("change", () => {
      actions.selectRoom(roomToggle.value);
      showList();
    });
    const heading = element("div", "", "survey-action-row");
    heading.append(button("Паспорт", showPassport), button("Настроить помещение", () => showRoom(true)), button("+ Помещение", () => showRoom(false)));
    const options = element("div", "", "survey-action-row");
    for (const kind of surveyPresets[room.preset].types) {
      options.append(button(`+ ${surveyKinds[kind].label}`, () => {
        draft = normalizeSurveyRecord({id: actions.newId(), kind,
          values: kind === "control" ? {tolerance: survey.tolerance} : kind === "niche" ? {level1: 0, level2: 1200, level3: 2250} : {}});
        if (kind === "contour") draft.outlineId = actions.selectedOutline();
        showRecord();
      }));
    }
    const list = element("ul", "", "survey-record-list");
    const entries = [];
    for (const record of room.records) {
      const item = element("li");
      const {detail, issue} = describeSurveyRecord(record, entities, survey.datum);
      const edit = button(record.title, () => {
        draft = normalizeSurveyRecord(record);
        showRecord();
      }, "survey-record-title");
      edit.prepend(element("small", `№${record.number} · `));
      edit.setAttribute("aria-label", record.title);
      item.append(edit);
      if (detail) item.append(element("p", detail, issue && !record.decision ? "survey-attention" : ""));
      if (record.point || record.outlineId) item.append(button("На плане", () => { dialog.close(); actions.locate(record); }));
      list.append(item);
      entries.push({ item, keywords: [`№${record.number}`, record.title, detail].join(" ").toLocaleLowerCase("ru") });
    }
    const empty = element("p", "Добавьте точку, проём или контрольный отсчёт.", "survey-subtitle");
    const search = input("recordSearch", "", { type: "search", autocomplete: "off", placeholder: "Название, номер или значение" });
    const searchStatus = element("p", "", "survey-subtitle");
    searchStatus.setAttribute("role", "status");
    search.addEventListener("input", () => {
      const terms = search.value.toLocaleLowerCase("ru").trim().split(/\s+/u);
      let visible = 0;
      for (const { item, keywords } of entries) {
        item.hidden = !terms.every((term) => keywords.includes(term));
        if (!item.hidden) visible++;
      }
      const result = visible ? `Найдено ${visible} из ${entries.length}` : "Записи не найдены";
      searchStatus.textContent = search.value.trim() ? result : "";
    });
    const controls = [subtitle, labelControl("Помещение", roomToggle), heading, options,
      element("h3", `Записи · ${room.records.length}`)];
    if (entries.length) controls.push(labelControl("Поиск по записям", search), searchStatus, list);
    else controls.push(empty);
    display("Замер", controls);
  }

  function showRecord(message = "") {
    const {survey, room, entities} = actions.context();
    const record = draft;
    const kind = surveyKinds[record.kind];
    const feedback = element("p", message, "survey-feedback");
    feedback.setAttribute("role", "alert");
    const {form, footer} = formWithFooter(() => {
      remember();
      const validation = validateRecord(record, entities);
      feedback.textContent = validation;
      if (validation) return;
      actions.saveRecord(record);
      showList();
    });
    const titleField = input("title", record.title, {maxlength: 100, required: ""});
    form.append(labelControl("Название записи", titleField));
    if (record.kind === "point") {
      const category = select("pointType", surveyPointTypes.map((type) => [type, type]), record.pointType);
      category.addEventListener("change", () => {
        if (titleField.value === kind.label || titleField.value === record.pointType) titleField.value = category.value;
        record.pointType = category.value;
      });
      form.append(labelControl("Тип точки", category));
    }
    if (record.kind === "opening") {
      form.append(labelControl("Тип проёма", select("openingType", surveyOpeningTypes.map((type) => [type, type]), record.openingType)));
    }
    const positions = element("div", "", "survey-action-row");
    for (const [index, name] of kind.positions.entries()) {
      const key = surveyPositionKeys[index];
      const coordinate = record[key];
      const label = coordinate ? `${name} · ✓` : name;
      positions.append(button(label, () => {
        remember();
        dialog.close();
        actions.pickPoint(name, (point) => {
          if (point) record[key] = point;
          showRecord();
        });
      }));
    }
    if (kind.positions.length) form.append(positions);
    if (record.kind === "contour") {
      const outlines = entities.filter((item) => item.type === "polyline" && item.closed);
      const choices = outlines.map((item, index) => [item.id, `Контур ${index + 1} · ${item.points.length} вершин`]);
      const outer = select("outlineId", [["", "Выберите контур"], ...choices], record.outlineId);
      outer.addEventListener("change", () => {
        remember();
        record.holeIds = record.holeIds.filter((id) => id !== record.outlineId);
        showRecord();
      });
      form.append(labelControl("Внешний контур", outer));
      if (choices.length > 1) {
        const holes = element("fieldset");
        holes.append(element("legend", "Внутренние вычеты"));
        for (const [id, name] of choices.filter(([id]) => id !== record.outlineId)) {
          const control = input("hole", id, {type: "checkbox"});
          control.checked = record.holeIds.includes(id);
          holes.append(labelControl(name, control));
        }
        form.append(holes);
      }
    }
    const numbers = element("div", "", "survey-number-fields");
    for (const [key, name, , required] of kind.fields) {
      const value = record.values[key] === undefined ? "" : String(record.values[key]).replace(".", ",");
      const control = input(key, value, { inputmode: "decimal" });
      if (required) control.required = true;
      numbers.append(numericField(name, control));
    }
    if (kind.fields.length) form.append(numbers);
    if (record.kind === "control") {
      form.append(labelControl("Решение", select("decision", [["", "Ожидает проверки"], ["verified", "Перепроверено"], ["accepted", "Оставлено как замерено"]], record.decision)),
        labelControl("Причина или результат перепроверки", input("reason", record.reason, {maxlength: 250})));
    }
    form.append(labelControl("Источник отсчёта", input("source", record.source, {maxlength: 100, placeholder: "Рулетка, лазер или вручную"})),
      labelControl("Примечание", textarea("note", record.note, 600)));
    if (kind.fields.length) {
      form.append(button("Отсчёт с дальномера", () => {
        remember();
        const names = kind.fields.filter(([key]) => !/^level|^tolerance|^computed/.test(key));
        showLaser(names);
      }));
    }
    const photoInput = input("photo", "", {type: "file", accept: "image/*"});
    photoInput.addEventListener("change", async () => {
      remember();
      if (!photoInput.files.length) return;
      try {
        const photo = await compressPhoto(photoInput.files[0]);
        if (!dialog.open || draft !== record || actions.context().room.id !== room.id) return;
        const total = survey.rooms.flatMap((item) => item.records).filter((item) => item.id !== record.id)
          .reduce((sum, item) => sum + item.photo.length, 0);
        if (total + photo.length > surveyMaxTotalPhotoBytes) throw new Error("Место для фото заполнено. Удалите ненужное фото из этого проекта");
        record.photo = photo;
        showRecord();
      } catch (error) {
        feedback.textContent = error.message;
      }
    });
    form.append(labelControl("Фото точки или помещения", photoInput));
    if (record.photo) {
      const image = element("img", "", "survey-photo");
      image.alt = `Фото записи «${record.title}»`;
      image.src = record.photo;
      form.append(image, button("Убрать фото", () => { remember(); record.photo = ""; showRecord(); }));
    }
    const result = element("p", "", "survey-result");
    result.setAttribute("aria-live", "polite");
    function remember() {
      const fields = fieldValues(form);
      record.title = String(fields.get("title")).trim().slice(0, 100);
      record.note = String(fields.get("note") ?? "").trim();
      record.source = String(fields.get("source") ?? "").trim();
      if (record.kind === "point") record.pointType = fields.get("pointType");
      if (record.kind === "opening") record.openingType = fields.get("openingType");
      if (record.kind === "control") {
        record.decision = fields.get("decision");
        record.reason = String(fields.get("reason") ?? "").trim();
      }
      if (record.kind === "contour") {
        record.outlineId = String(fields.get("outlineId") ?? "");
        record.holeIds = fields.getAll("hole").filter((id) => id !== record.outlineId);
      }
      for (const [key] of kind.fields) {
        const value = parseLineDecimal(String(fields.get(key) ?? ""));
        if (value === null) delete record.values[key];
        else record.values[key] = value;
      }
    }
    function refresh() {
      remember();
      result.textContent = describeSurveyRecord(record, entities, survey.datum).summary;
      result.hidden = !result.textContent;
    }
    form.addEventListener("change", (event) => {
      if (event.target !== photoInput && event.target.name !== "outlineId") refresh();
    });
    form.append(result, feedback, footer);
    if (room.records.some((item) => item.id === record.id)) {
      form.insertBefore(button("Удалить запись", () => {
        if (window.confirm(`Удалить запись «${record.title}»?`)) { actions.removeRecord(record.id); showList(); }
      }), footer);
    }
    refresh();
    display(kind.label, [form]);
  }

  function validateRecord(record, entities) {
    if (!record.title.trim()) return "Введите название записи";
    for (const [key, name, min, required] of surveyKinds[record.kind].fields) {
      const value = record.values[key];
      const field = content.querySelector(`[name="${key}"]`);
      const invalid = (required || field?.value.trim()) && (!Number.isFinite(value) || value < min || value > 1e9);
      if (invalid) { field?.focus(); return `Проверьте поле «${name}»`; }
    }
    if (record.kind === "control" && !Number.isFinite(record.values.computed) && !(record.point && record.end)) {
      return "Укажите две точки на плане или введите расчётное значение";
    }
    if (record.kind === "control" && record.decision === "accepted" && !record.reason) return "Укажите причину для принятого расхождения";
    if (record.kind === "contour") {
      const byId = new Map(entities.map((entity) => [entity.id, entity]));
      return measureSurveyContour(byId.get(record.outlineId), record.holeIds.map((id) => byId.get(id))).error || "";
    }
    return "";
  }

  function showLaser(fields) {
    if (!laser) laser = actions.createLaser();
    const target = select("readingTarget", fields.map(([id, title]) => [id, title]), fields[0]?.[0]);
    const status = element("p", "Подключите Leica DISTO D2 и выполните замер на приборе.", "survey-result");
    status.setAttribute("role", "status");
    const reading = element("p", "", "survey-result");
    let lastReading = null;
    const accept = button("Применить отсчёт", () => {
      if (lastReading === null) return;
      draft.values[target.value] = lastReading;
      draft.source = laser.name || "Bluetooth-дальномер";
      laser.disconnect();
      showRecord();
    }, "survey-primary");
    accept.disabled = true;
    const connect = button("Подключить по Bluetooth", async () => {
      lastReading = null;
      accept.disabled = true;
      connect.disabled = true;
      try {
        await laser.connect((value) => {
          lastReading = value;
          reading.textContent = `${surveyNumber(value, 3)} мм`;
          accept.disabled = false;
        }, (text, state) => {
          status.textContent = text;
          if (state === "disconnected" || state === "error") {
            lastReading = null;
            reading.textContent = "";
            connect.disabled = false;
            accept.disabled = true;
          }
        });
      } catch (error) {
        status.textContent = error.message;
        connect.disabled = false;
      }
    });
    const cancel = button("К записи", () => { laser.disconnect(); showRecord(); });
    const reconnect = button("Отключить", () => {
      laser.disconnect();
      lastReading = null;
      reading.textContent = "";
      connect.disabled = false;
      accept.disabled = true;
      status.textContent = "Прибор отключён";
    });
    display("Показание дальномера", [labelControl("Сохранить в поле", target), status, reading, connect, reconnect, accept, cancel]);
  }

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => laser?.disconnect());
  return {open: showList, close: () => { if (dialog.open) dialog.close(); }};
}
