import type { Account, Category, Member } from "@/lib/types";

export interface Lookups {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  members: Map<string, Member>;
}

export function toLookups(accounts: Account[], categories: Category[], members: Member[]): Lookups {
  return {
    accounts: new Map(accounts.map((a) => [a.id, a])),
    categories: new Map(categories.map((c) => [c.id, c])),
    members: new Map(members.map((m) => [m.id, m])),
  };
}
