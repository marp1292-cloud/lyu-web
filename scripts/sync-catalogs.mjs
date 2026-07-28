#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID =
  process.env.CATALOG_SHEET_ID ??
  "1GEyYfnsI1TD4jH0DKnbK6ADzcHdf5AVuCrwY-mgl9hs";
const CHECK_ONLY = process.argv.includes("--check");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CATEGORY_CODES = new Map([
  ["hogar y organizacion", "hogar"],
  ["cocina", "cocina"],
  ["limpieza", "limpieza"],
  ["iluminacion y decoracion", "iluminacion"],
  ["belleza y cuidado personal", "belleza"],
  ["ninos, auto y mas", "variados"],
]);

const STORES = [
  {
    key: "lyu",
    file: "index.html",
    sheetName: "IMPORTADORA LYU",
    unitColumn: 4,
    wholesaleColumn: 5,
    boxColumn: 6,
    badgeMap: {
      mas_vendido: "mas_vendido",
      nuevo: "nuevo",
      oferta: "oferta",
    },
  },
  {
    key: "qhathu",
    file: "qhathu/index.html",
    sheetName: "QHATHU",
    unitColumn: 8,
    wholesaleColumn: 9,
    badgeMap: {
      mas_vendido: "exclusivo",
      nuevo: "nuevo",
      oferta: "destacado",
    },
  },
  {
    key: "shopix",
    file: "shopix/index.html",
    sheetName: "SHOPIX",
    unitColumn: 12,
    wholesaleColumn: 13,
    badgeMap: {
      mas_vendido: "popular",
      nuevo: "nuevo",
      oferta: "oferta",
    },
  },
  {
    key: "nova",
    file: "nova/index.html",
    sheetName: "NOVA MARKET",
    unitColumn: 16,
    wholesaleColumn: 17,
    badgeMap: {
      mas_vendido: "favorito",
      nuevo: "nuevo",
      oferta: "ahorra",
    },
  },
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function isYes(value) {
  return ["si", "yes", "true", "1"].includes(normalize(value));
}

function parseNumber(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;

  let normalized = text;
  if (text.includes(",") && text.includes(".")) {
    normalized =
      text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (text.includes(",")) {
    normalized = text.replace(",", ".");
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function requiredNumber(value, label) {
  const number = parseNumber(value);
  if (number === null) {
    throw new Error(`Falta un valor numérico válido en ${label}.`);
  }
  return number;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }

  if (quoted) throw new Error("El CSV recibido tiene comillas sin cerrar.");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((currentRow) =>
    currentRow.some((currentCell) => String(currentCell).trim() !== ""),
  );
}

async function fetchSheetCsv(sheetName) {
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: sheetName,
  });
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params}`;
  const response = await fetch(url, {
    headers: { "user-agent": "catalogos-multitienda-sync/1.0" },
  });

  if (!response.ok) {
    throw new Error(
      `Google Sheets respondió ${response.status} al leer "${sheetName}".`,
    );
  }

  return parseCsv(await response.text());
}

function rowsToObjects(rows) {
  const [headers, ...dataRows] = rows;
  if (!headers) throw new Error("La hoja no contiene encabezados.");

  return dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function productIndex(productsRows) {
  const records = rowsToObjects(productsRows);
  const products = records
    .filter((record) => isYes(record.ACTIVO) && isYes(record.PUBLICAR))
    .map((record) => {
      const id = requiredNumber(record.ID, `Productos/ID (${record.NOMBRE})`);
      const category = CATEGORY_CODES.get(normalize(record.CATEGORIA));
      const image = String(record.IMAGEN_LINK ?? "").trim();

      if (!category) {
        throw new Error(
          `La categoría "${record.CATEGORIA}" del producto ${id} no está configurada.`,
        );
      }
      if (!String(record.NOMBRE ?? "").trim()) {
        throw new Error(`El producto ${id} no tiene nombre.`);
      }
      if (!image.startsWith("https://")) {
        throw new Error(`El producto ${id} no tiene un enlace HTTPS de imagen.`);
      }

      return {
        id,
        nombre: String(record.NOMBRE).trim(),
        desc: String(record.DESCRIPCION_CORTA || record.DESCRIPCION || "").trim(),
        cat: category,
        sourceBadge: normalize(record.BADGE) || null,
        uc: requiredNumber(
          record.UNIDADES_CAJA,
          `Productos/UNIDADES_CAJA (producto ${id})`,
        ),
        img: image,
      };
    });

  if (!products.length) {
    throw new Error("No hay productos marcados ACTIVO=Sí y PUBLICAR=Sí.");
  }

  const ids = new Set();
  for (const product of products) {
    if (ids.has(product.id)) {
      throw new Error(`El ID ${product.id} está duplicado en Productos.`);
    }
    ids.add(product.id);
  }

  return products.sort((left, right) => left.id - right.id);
}

function priceIndex(priceRows) {
  const rows = priceRows.slice(1);
  const prices = new Map();

  for (const row of rows) {
    const id = parseNumber(row[0]);
    if (id === null) continue;
    if (prices.has(id)) throw new Error(`El ID ${id} está duplicado en Precios.`);
    prices.set(id, row);
  }

  return prices;
}

function storePhones(storeRows) {
  const [headers, ...rows] = storeRows;
  const whatsappRow = rows.find((row) => normalize(row[0]) === "whatsapp");
  if (!headers || !whatsappRow) {
    throw new Error('No se encontró la fila "WhatsApp" en Datos Tiendas.');
  }

  return Object.fromEntries(
    headers.slice(1).map((storeName, index) => {
      const phone = String(whatsappRow[index + 1] ?? "").replace(/\D/g, "");
      if (!/^591\d{8}$/.test(phone)) {
        throw new Error(`WhatsApp inválido para ${storeName}: "${phone}".`);
      }
      return [storeName, phone];
    }),
  );
}

function buildStoreProducts(products, prices, store) {
  return products.map((product) => {
    const priceRow = prices.get(product.id);
    if (!priceRow) {
      throw new Error(`No existe una fila de precios para el producto ${product.id}.`);
    }

    const result = {
      id: product.id,
      nombre: product.nombre,
      desc: product.desc,
      cat: product.cat,
      badge: product.sourceBadge
        ? (store.badgeMap[product.sourceBadge] ?? "nuevo")
        : null,
      pu: requiredNumber(
        priceRow[store.unitColumn],
        `Precios/${store.key}/UNIDAD (producto ${product.id})`,
      ),
      pm: requiredNumber(
        priceRow[store.wholesaleColumn],
        `Precios/${store.key}/MAYOR (producto ${product.id})`,
      ),
    };

    if (store.boxColumn !== undefined) {
      result.pc = requiredNumber(
        priceRow[store.boxColumn],
        `Precios/${store.key}/CAJA (producto ${product.id})`,
      );
    }

    if (result.pm > result.pu) {
      console.warn(
        `AVISO: ${store.key.toUpperCase()} producto ${product.id} tiene MAYOR (${result.pm}) mayor que UNIDAD (${result.pu}).`,
      );
    }

    result.uc = product.uc;
    result.img = product.img;
    return result;
  });
}

function replaceOnce(text, pattern, replacement, label) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(
      `${label}: se esperaba 1 coincidencia y se encontraron ${matches?.length ?? 0}.`,
    );
  }
  return text.replace(pattern, replacement);
}

function updateHtml(html, products, phone, store) {
  let updated = replaceOnce(
    html,
    /const PRODUCTOS = \[[\s\S]*?\];/,
    `const PRODUCTOS = ${JSON.stringify(products)};`,
    `${store.file}/PRODUCTOS`,
  );

  updated = replaceOnce(
    updated,
    /<strong>\d+<\/strong>\s*productos disponibles/i,
    `<strong>${products.length}</strong> productos disponibles`,
    `${store.file}/contador`,
  );

  if (store.key === "shopix") {
    updated = replaceOnce(
      updated,
      /<div class="num">\d+\+<\/div>/,
      `<div class="num">${products.length}+</div>`,
      `${store.file}/contador destacado`,
    );
  }

  const currentPhoneMatch = updated.match(/const WHATSAPP = "(\d+)";/);
  if (!currentPhoneMatch) {
    throw new Error(`${store.file}: no se encontró const WHATSAPP.`);
  }
  updated = updated.split(currentPhoneMatch[1]).join(phone);

  return updated;
}

async function main() {
  const [productsRows, priceRows, storeRows] = await Promise.all([
    fetchSheetCsv("Productos"),
    fetchSheetCsv("Precios"),
    fetchSheetCsv("Datos Tiendas"),
  ]);

  const sourceProducts = productIndex(productsRows);
  const prices = priceIndex(priceRows);
  const phones = storePhones(storeRows);
  const changedFiles = [];

  for (const store of STORES) {
    const products = buildStoreProducts(sourceProducts, prices, store);
    const filePath = path.join(ROOT, store.file);
    const currentHtml = await readFile(filePath, "utf8");
    const updatedHtml = updateHtml(
      currentHtml,
      products,
      phones[store.sheetName],
      store,
    );

    if (updatedHtml !== currentHtml) {
      changedFiles.push(store.file);
      if (!CHECK_ONLY) await writeFile(filePath, updatedHtml, "utf8");
    }

    console.log(
      `${store.key.toUpperCase()}: ${products.length} productos, WhatsApp ${phones[store.sheetName]}`,
    );
  }

  if (CHECK_ONLY && changedFiles.length) {
    console.error(`Desactualizados: ${changedFiles.join(", ")}`);
    process.exitCode = 2;
  } else if (changedFiles.length) {
    console.log(`Actualizados: ${changedFiles.join(", ")}`);
  } else {
    console.log("Los cuatro catálogos ya estaban actualizados.");
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
