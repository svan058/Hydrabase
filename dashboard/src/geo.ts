import ipLookup from "@iplookup/country"
import { countryCodeEmoji } from "country-code-emoji"

export const toEmoji = (country: string): string => country === "N/A" || country === '-' ? "🌐" : countryCodeEmoji(country)

const ipMap = new Map<string, string>()

export const getCountry = async (ip: string): Promise<string> => {
  const known = ipMap.get(ip)
  if (known) return known
  const result = await ipLookup(ip)
  if (!result || !("country" in result) || !result.country) return "N/A"
  const { country } = result
  ipMap.set(ip, country)
  return country
};
