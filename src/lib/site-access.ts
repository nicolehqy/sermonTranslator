export const ACCESS_COOKIE = "sermon-translator-access";

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function equalHash(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function accessRequired() {
  return Boolean(process.env.SITE_PASSWORD) || Boolean(process.env.VERCEL);
}

export async function accessToken() {
  const password = process.env.SITE_PASSWORD;
  return password ? digest(`sermon-translator:${password}`) : null;
}

export async function passwordIsValid(password: string) {
  const expectedPassword = process.env.SITE_PASSWORD;
  if (!expectedPassword) return false;
  return equalHash(await digest(password), await digest(expectedPassword));
}

export async function cookieHasValidAccess(cookieValue: string | undefined) {
  if (!accessRequired()) return true;
  const expected = await accessToken();
  return Boolean(expected && cookieValue && equalHash(cookieValue, expected));
}

export function cookieValue(header: string | null, name: string) {
  return header?.split(";").map(part => part.trim().split("=")).find(([key]) => key === name)?.slice(1).join("=");
}
