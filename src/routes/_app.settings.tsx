import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth, friendlyAuthError } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TelegramSettings } from "@/components/telegram-settings";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [notify, setNotify] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (data) {
        setFullName(data.full_name ?? user.user_metadata?.full_name ?? "");
        if (typeof data.notifications_enabled === "boolean") setNotify(data.notifications_enabled);
      } else {
        setFullName(user.user_metadata?.full_name ?? "");
      }
    })();
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error: uErr } = await supabase.auth.updateUser({ data: { full_name: fullName } });
      if (uErr) throw uErr;
      const { error: pErr } = await supabase
        .from("profiles")
        .upsert({ id: user.id, full_name: fullName, notifications_enabled: notify }, { onConflict: "id" });
      if (pErr && !/relation.*does not exist/i.test(pErr.message)) throw pErr;
      toast.success("Profile saved");
    } catch (e) {
      toast.error(friendlyAuthError(e));
    } finally {
      setSavingProfile(false);
    }
  }

  async function sendReset() {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Password reset email sent");
    } catch (e) {
      toast.error(friendlyAuthError(e));
    } finally {
      setSendingReset(false);
    }
  }

  async function deleteAccount() {
    // We can only sign out; deletion requires admin API. Give the user a clear message.
    await supabase.auth.signOut();
    toast.message("Signed out", { description: "To fully delete your account, contact support." });
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your parent account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium text-sm">Email notifications</div>
              <div className="text-xs text-muted-foreground">Receive alert notifications by email.</div>
            </div>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </div>
          <Button onClick={saveProfile} disabled={savingProfile}>
            {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
          </Button>
        </CardContent>
      </Card>

      <TelegramSettings />

      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={sendReset} disabled={sendingReset}>
            {sendingReset && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send password reset email
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle></CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" /> Delete account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will sign you out. Full account deletion is completed by support to
                  ensure children's device data is cleaned up correctly.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteAccount}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
