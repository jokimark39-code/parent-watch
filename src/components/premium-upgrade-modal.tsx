import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Crown, Upload, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Replace these placeholder QR URLs with your real KPay / Wave / AYA QR images.
// You can drop files at /public/qr/kpay.png etc. and change the `qr` field below.
const PAYMENT_METHODS = [
  {
    id: "KPay",
    name: "KPay",
    account: "Yat Lite",
    phone: "09XXXXXXXXX",
    qr: "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=KPay%3AYatLite%3A09XXXXXXXXX%3A5000MMK",
  },
  {
    id: "WavePay",
    name: "Wave Pay",
    account: "Yat Lite",
    phone: "09XXXXXXXXX",
    qr: "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=WavePay%3AYatLite%3A09XXXXXXXXX%3A5000MMK",
  },
  {
    id: "AYAPay",
    name: "AYA Pay",
    account: "Yat Lite",
    phone: "09XXXXXXXXX",
    qr: "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=AYAPay%3AYatLite%3A09XXXXXXXXX%3A5000MMK",
  },
] as const;

const AMOUNT_MMK = 5000;

export function PremiumUpgradeModal({
  open,
  onOpenChange,
  onActivated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onActivated: () => void;
}) {
  const { user } = useAuth();
  const [method, setMethod] = useState<string>("KPay");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!user) {
      toast.error("You must be signed in.");
      return;
    }
    if (!method) {
      toast.error("Please select a payment method.");
      return;
    }
    if (!file) {
      toast.error("Please upload your payment screenshot.");
      return;
    }

    setSubmitting(true);
    try {
      // Demo mode: skip real upload / real payment validation.
      await new Promise((r) => setTimeout(r, 800));

      // Best-effort: record payment + flip profile flag. Ignore failures.
      try {
        await supabase.from("premium_payments").insert({
          parent_id: user.id,
          email: user.email,
          payment_method: method,
          screenshot_url: null,
          status: "approved",
          amount: AMOUNT_MMK,
        });
      } catch {
        /* demo mode — ignore */
      }

      try {
        await supabase.from("profiles").upsert(
          {
            id: user.id,
            email: user.email,
            is_premium: true,
            premium_plan: "telegram_alerts",
            premium_activated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
      } catch {
        /* demo mode — ignore */
      }

      // Local fallback so premium sticks even if Supabase writes failed.
      try {
        localStorage.setItem(`premium:${user.id}`, "1");
      } catch {
        /* ignore */
      }

      toast.success("Premium activated successfully.");
      onActivated();
      onOpenChange(false);
      setFile(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Upgrade to Premium
          </DialogTitle>
          <DialogDescription>
            Unlock Telegram bot alerts for high-risk app detection. Telegram alerts are a
            Premium feature. Please complete payment and upload your payment screenshot to
            unlock Telegram Alerts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">Telegram Alerts Plan</span>
              <span className="text-lg font-semibold">5,000 MMK</span>
            </div>
            <p className="text-xs text-muted-foreground">One-time demo activation.</p>
          </div>

          <RadioGroup value={method} onValueChange={setMethod} className="grid gap-3 md:grid-cols-3">
            {PAYMENT_METHODS.map((m) => (
              <label
                key={m.id}
                htmlFor={`pay-${m.id}`}
                className={cn(
                  "cursor-pointer rounded-lg border p-3 transition-colors",
                  method === m.id ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{m.name}</div>
                  <RadioGroupItem id={`pay-${m.id}`} value={m.id} />
                </div>
                <div className="mt-2 flex items-center justify-center rounded-md bg-white p-2">
                  <img
                    src={m.qr}
                    alt={`${m.name} QR`}
                    className="h-32 w-32 object-contain"
                    loading="lazy"
                  />
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Account:</span> {m.account}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Phone:</span> {m.phone}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Amount:</span> 5,000 MMK
                  </div>
                </div>
              </label>
            ))}
          </RadioGroup>

          <div className="space-y-2">
            <Label htmlFor="screenshot">Upload payment screenshot</Label>
            <div className="flex items-center gap-2">
              <Input
                id="screenshot"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {file && (
              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {file.name}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Activating Premium…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" /> Submit Payment
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
