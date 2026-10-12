import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { Redirect } from "expo-router";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { API_URL } from "../lib/config";
import { Btn, ErrorText, Input, Row, Seg, T } from "../components/ui";

export default function Login() {
  const t = useTheme();
  const { accessToken, setSession } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ identifier: "", email: "", username: "", password: "" });
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  if (accessToken) return <Redirect href="/" />;

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr(null);
    try { setSession(await fn()); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
  };
  const submit = () => run(() => mode === "login"
    ? post("/api/auth/login", { identifier: f.identifier.trim(), password: f.password })
    : post("/api/auth/register", { email: f.email.trim(), username: f.username.trim(), password: f.password }));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", gap: 6, marginBottom: 10 }}>
          <T v="big" color={t.primary} style={{ fontStyle: "italic", fontWeight: "900", fontSize: 40 }}>RM</T>
          <T v="h1">RM Markets</T>
          <T v="small" color={t.muted} style={{ textAlign: "center" }}>Practice trading with live markets and a $100,000 virtual balance. No real money, no risk.</T>
        </View>
        <Seg value={mode} onChange={setMode} options={[{ value: "login", label: "Sign in" }, { value: "register", label: "Create account" }]} />
        {mode === "login" ? (
          <Input label="Email or username" autoCapitalize="none" autoComplete="username" value={f.identifier} onChangeText={(v) => setF({ ...f, identifier: v })} />
        ) : (
          <>
            <Input label="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} />
            <Input label="Username" autoCapitalize="none" value={f.username} onChangeText={(v) => setF({ ...f, username: v })} />
          </>
        )}
        <Input label="Password" secureTextEntry autoComplete={mode === "login" ? "password" : "new-password"} value={f.password} onChangeText={(v) => setF({ ...f, password: v })} />
        <ErrorText error={err} />
        <Btn kind="primary" title={mode === "login" ? "Sign in" : "Create account"} loading={busy} onPress={submit} />
        <Row style={{ justifyContent: "center" }}><T v="tiny" color={t.faint}>or</T></Row>
        <Btn title="Try instantly as a guest" onPress={() => run(() => post("/api/auth/demo"))} disabled={busy} />
        <T v="tiny" color={t.faint} style={{ textAlign: "center" }}>Server: {API_URL}</T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
