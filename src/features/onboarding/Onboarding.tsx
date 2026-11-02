import { Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/common/layout";
import { CurrencySelect } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

/** First run: the user's name, the base currency and optionally a family workspace. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const L = useL();
  const [userName, setUserName] = useState("");
  const [personalName, setPersonalName] = useState(L.onboarding.personalDefault);
  const [currency, setCurrency] = useState("RUB");
  const [family, setFamily] = useState(false);
  const [familyName, setFamilyName] = useState(L.onboarding.familyDefault);
  const [busy, setBusy] = useState(false);

  const valid = userName.trim() !== "" && personalName.trim() !== "" && (!family || familyName.trim() !== "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.completeOnboarding({
        userName: userName.trim(),
        personalName: personalName.trim(),
        baseCurrency: currency,
        familyName: family ? familyName.trim() : null,
      });
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, L));
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <Card className="w-full max-w-lg">
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Wallet className="size-6" />
              </span>
              <h1 className="text-xl">{L.onboarding.title}</h1>
              <p className="text-sm text-muted-foreground">{L.onboarding.subtitle}</p>
            </div>
            <Field label={L.onboarding.userName} htmlFor="ob-user">
              <Input id="ob-user" autoFocus value={userName} maxLength={60} onChange={(e) => setUserName(e.target.value)} />
            </Field>
            <Field label={L.onboarding.personalName} htmlFor="ob-personal">
              <Input
                id="ob-personal"
                value={personalName}
                maxLength={60}
                onChange={(e) => setPersonalName(e.target.value)}
              />
            </Field>
            <Field label={L.onboarding.currency} htmlFor="ob-currency" hint={L.onboarding.currencyHint}>
              <CurrencySelect id="ob-currency" value={currency} onChange={setCurrency} />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <span className="text-sm">{L.onboarding.family}</span>
              <Switch checked={family} onCheckedChange={setFamily} />
            </label>
            {family && (
              <Field label={L.onboarding.familyName} htmlFor="ob-family">
                <Input
                  id="ob-family"
                  value={familyName}
                  maxLength={60}
                  onChange={(e) => setFamilyName(e.target.value)}
                />
              </Field>
            )}
            <Button type="submit" size="lg" disabled={!valid || busy}>
              {L.onboarding.start}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
