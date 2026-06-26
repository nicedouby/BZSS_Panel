<template>
  <main class="login-page">
    <!-- Dynamic background blobs -->
    <div class="bg-blob bg-blob-1" aria-hidden="true"></div>
    <div class="bg-blob bg-blob-2" aria-hidden="true"></div>
    <div class="bg-blob bg-blob-3" aria-hidden="true"></div>

    <div class="login-shell">
      <!-- Left Column: Branding Hero (Visible on Desktop) -->
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

      <!-- Right Column: Login Form -->
      <section class="login-panel">
        <div class="panel-head">
          <h2>Sign in</h2>
          <p>Enter the panel using your operator credentials.</p>
        </div>

        <form @submit.prevent="submit">
          <!-- Username field -->
          <div class="form-field">
            <label for="username-input" class="field-label">{{ t("login.username") }}</label>
            <input
              id="username-input"
              v-model="username"
              autocomplete="username"
              required
              class="form-input"
              placeholder="Username"
            />
          </div>

          <!-- Password field -->
          <div class="form-field">
            <label for="password-input" class="field-label">{{ t("login.password") }}</label>
            <div class="password-wrapper">
              <input
                id="password-input"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="form-input password-input"
                placeholder="Password"
              />
              <button
                type="button"
                class="password-toggle"
                @click="togglePasswordVisibility"
                aria-label="Toggle password visibility"
              >
                <!-- eye off SVG icon -->
                <svg
                  v-if="showPassword"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="toggle-icon"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
                <!-- eye SVG icon -->
                <svg
                  v-else
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="toggle-icon"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
          </div>
          <!-- Remember Me checkbox -->
          <div class="form-options">
            <label class="remember-me-label">
              <input
                type="checkbox"
                v-model="rememberMe"
                class="remember-checkbox"
              />
              <span class="remember-text">记住账号</span>
            </label>
          </div>

          <button type="submit" class="submit-btn" :disabled="loading">
            {{ loading ? t("login.loggingIn") : t("login.login") }}
          </button>
        </form>

        <ErrorBlock v-if="errorText" :message="errorText" />
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
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
const rememberMe = ref(false);
const showPassword = ref(false);
const loading = ref(false);
const localError = ref("");
const errorText = computed(() => localError.value || auth.error || "");

onMounted(() => {
  const savedUsername = localStorage.getItem("remembered_username");
  if (savedUsername) {
    username.value = savedUsername;
    rememberMe.value = true;
  }
});

function togglePasswordVisibility() {
  showPassword.value = !showPassword.value;
}

async function submit() {
  loading.value = true;
  localError.value = "";
  try {
    await auth.login(username.value, password.value);
    
    if (rememberMe.value) {
      localStorage.setItem("remembered_username", username.value);
    } else {
      localStorage.removeItem("remembered_username");
    }
    
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
  min-height: 100dvh;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px;
  background: #030712;
  position: relative;
  overflow: hidden;
}

/* Background blob decorations */
.bg-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.12;
  z-index: 0;
  pointer-events: none;
  animation: float 25s infinite alternate ease-in-out;
}

.bg-blob-1 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, var(--color-brand-primary, #37c8ff) 0%, transparent 70%);
  top: -10%;
  left: -10%;
}

.bg-blob-2 {
  width: 600px;
  height: 600px;
  background: radial-gradient(circle, var(--color-brand-secondary, #ff9b45) 0%, transparent 70%);
  bottom: -15%;
  right: -10%;
  animation-delay: -6s;
}

.bg-blob-3 {
  width: 450px;
  height: 450px;
  background: radial-gradient(circle, var(--color-brand-tertiary, #f472b6) 0%, transparent 70%);
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation-delay: -12s;
  opacity: 0.06;
}

@keyframes float {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(50px, -70px) scale(1.1); }
  100% { transform: translate(-30px, 40px) scale(0.95); }
}

.login-shell {
  width: min(1080px, 100%);
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 32px;
  position: relative;
  z-index: 1;
  align-items: center;
}

.login-hero {
  padding: clamp(24px, 3.5vw, 48px);
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero-eyebrow {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-brand-primary, #37c8ff);
  text-shadow: 0 0 10px rgba(55, 200, 255, 0.2);
}

.hero-copy h1 {
  margin: 0;
  font-size: clamp(38px, 4.5vw, 64px);
  line-height: 0.95;
  letter-spacing: -0.04em;
  font-weight: 900;
  background: linear-gradient(135deg, #ffffff 30%, var(--color-text-secondary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 15px;
  line-height: 1.65;
  max-width: 50ch;
}

.hero-points {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hero-point {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 20px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.03);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(8px);
  transition: transform 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
}

.hero-point:hover {
  transform: translateX(4px);
  border-color: rgba(96, 165, 250, 0.15);
  background: rgba(255, 255, 255, 0.04);
}

.hero-point strong {
  font-size: 14px;
  color: var(--color-text-primary);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.hero-point span {
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

/* Login Panel (Frosted glass card) */
.login-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 36px 32px;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(15, 23, 42, 0.65);
  box-shadow: 
    0 4px 30px rgba(0, 0, 0, 0.4),
    inset 0 1px 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.login-panel:focus-within {
  border-color: rgba(96, 165, 250, 0.28);
  box-shadow: 
    0 10px 40px rgba(0, 0, 0, 0.5),
    0 0 20px rgba(56, 189, 248, 0.06),
    inset 0 1px 1px rgba(255, 255, 255, 0.15);
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
}

.panel-head p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.login-panel form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.form-input {
  width: 100%;
  height: 42px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 7, 18, 0.6);
  color: var(--color-text-primary);
  padding: 0 14px;
  font-size: 16px; /* Prevents auto-zoom on iOS */
  line-height: 1.5;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.form-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
  font-size: 14px;
}

.form-input:focus {
  border-color: var(--color-brand-primary, #37c8ff);
  background: rgba(3, 7, 18, 0.8);
  box-shadow: 0 0 0 3px rgba(55, 200, 255, 0.15);
  outline: none;
}

/* Password wrapper & visibility button */
.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-input {
  padding-right: 44px; /* Space for the eye icon button */
}

.password-toggle {
  position: absolute;
  right: 12px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  box-shadow: none;
  transition: color 0.15s ease, transform 0.15s ease;
}

.password-toggle:hover:not(:disabled) {
  color: var(--color-text-primary);
  transform: none;
  box-shadow: none;
}

.toggle-icon {
  width: 18px;
  height: 18px;
}

.form-options {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-top: -4px;
}

.remember-me-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.remember-checkbox {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--color-brand-primary, #37c8ff);
}

.remember-text {
  font-size: 13px;
  color: var(--color-text-muted);
}

.submit-btn {
  height: 44px;
  margin-top: 8px;
  border-radius: 10px;
  border: 1px solid var(--color-brand-primary, #37c8ff);
  background: linear-gradient(185deg, var(--color-brand-primary, #37c8ff) 0%, rgba(56, 189, 248, 0.8) 100%);
  color: #020617;
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(55, 200, 255, 0.25);
  transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(55, 200, 255, 0.35);
  border-color: #58d3ff;
}

.submit-btn:active:not(:disabled) {
  transform: translateY(0);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

/* Responsiveness */
@media (max-width: 860px) {
  .login-shell {
    grid-template-columns: 1fr;
    max-width: 440px;
    gap: 20px;
  }

  .login-hero {
    display: none; /* Hide hero on tablet & mobile */
  }

  .login-panel {
    padding: 32px 24px;
  }
}

@media (max-width: 480px) {
  .login-page {
    padding: 16px;
  }

  .login-panel {
    padding: 24px 20px;
    border-radius: 20px;
  }
}
</style>
