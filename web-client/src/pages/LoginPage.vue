<template>
  <main class="login-page">
    <div class="login-shell">
      <section class="login-hero">
        <div class="hero-copy">
          <p class="hero-eyebrow">Command Center</p>
          <h1>BZSS Panel</h1>
          <p class="hero-subtitle">{{ t("login.subtitle") }}</p>
        </div>

        <div class="hero-points">
          <article class="hero-point">
            <strong>Live sync</strong>
            <span>Match state, console output, and player data stay aligned in one surface.</span>
          </article>
          <article class="hero-point">
            <strong>Focused control</strong>
            <span>Utility actions are grouped instead of scattered across separate screens.</span>
          </article>
          <article class="hero-point">
            <strong>Safer access</strong>
            <span>Authenticated entry keeps the operational surface protected.</span>
          </article>
        </div>
      </section>

      <section class="login-panel">
        <div class="panel-head">
          <h2>Sign in</h2>
          <p>Enter the panel using your operator credentials.</p>
        </div>

        <form @submit.prevent="submit">
          <label>
            <span>{{ t("login.username") }}</span>
            <input v-model="username" autocomplete="username" required />
          </label>
          <label>
            <span>{{ t("login.password") }}</span>
            <input v-model="password" type="password" autocomplete="current-password" required />
          </label>
          <button type="submit" :disabled="loading">{{ loading ? t("login.loggingIn") : t("login.login") }}</button>
        </form>

        <ErrorBlock v-if="errorText" :message="errorText" />
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import { t } from "../i18n";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const username = ref("");
const password = ref("");
const loading = ref(false);
const localError = ref("");
const errorText = computed(() => localError.value || auth.error || "");

async function submit() {
  loading.value = true;
  localError.value = "";
  try {
    await auth.login(username.value, password.value);
    const target = getPostLoginTarget();
    await router.replace(target);
  } catch (error: any) {
    if (error instanceof ApiError) {
      localError.value = error.status === 401 ? t("login.invalidCredentials") : error.message;
    } else {
      localError.value = error?.message ?? t("login.loginFailed");
    }
  } finally {
    loading.value = false;
  }
}

function getPostLoginTarget() {
  const target = String(route.fullPath || "/match-status").trim();
  if (!target || target === "/" || target === "/login") {
    return "/match-status";
  }

  return target;
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--app-background, var(--color-bg-page));
}

.login-shell {
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 430px);
  gap: 22px;
  align-items: stretch;
}

.login-hero,
.login-panel {
  border: 1px solid var(--color-border-default);
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.login-hero {
  padding: clamp(24px, 3vw, 36px);
  display: grid;
  gap: 28px;
  background:
    radial-gradient(circle at 12% 0%, rgba(56, 189, 248, 0.12), transparent 28%),
    radial-gradient(circle at 88% 0%, rgba(251, 146, 60, 0.08), transparent 30%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
}

.hero-copy {
  display: grid;
  gap: 10px;
}

.hero-eyebrow {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-status-info);
}

.hero-copy h1 {
  margin: 0;
  font-size: clamp(34px, 5vw, 56px);
  line-height: 0.98;
  letter-spacing: -0.05em;
}

.hero-subtitle {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 15px;
  line-height: 1.7;
  max-width: 58ch;
}

.hero-points {
  display: grid;
  gap: 12px;
}

.hero-point {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--color-border-soft);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.hero-point strong {
  font-size: 14px;
  letter-spacing: -0.01em;
}

.hero-point span {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.login-panel {
  width: 100%;
  display: grid;
  gap: 18px;
  padding: 24px;
}

.panel-head {
  display: grid;
  gap: 6px;
}

.panel-head h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.18;
}

.panel-head p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.login-panel form {
  display: grid;
  gap: 14px;
}

.login-panel label {
  display: grid;
  gap: 7px;
}

.login-panel label span {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.login-panel input {
  width: 100%;
}

.login-panel button[type="submit"] {
  min-height: 44px;
  margin-top: 4px;
  border-color: rgba(96, 165, 250, 0.24);
  background:
    linear-gradient(180deg, rgba(96, 165, 250, 0.95), rgba(56, 189, 248, 0.84));
  color: #04111d;
  font-weight: 700;
  box-shadow: var(--shadow-md);
}

.login-panel button[type="submit"]:hover:not(:disabled) {
  border-color: rgba(96, 165, 250, 0.34);
}

@media (max-width: 920px) {
  .login-shell {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .login-page {
    padding: 14px;
  }

  .login-hero,
  .login-panel {
    border-radius: 20px;
  }

  .login-panel {
    padding: 20px;
  }
}
</style>
