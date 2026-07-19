export function normalizeMasterText(value: string) {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function uppercaseMasterName(value: string) {
  return value.toUpperCase().replace(/\s+/g, " ");
}
