<template>
  <main class="login-page login-page--mascot">
    <div class="login-bg-grid" aria-hidden="true"></div>
    <div class="login-bg-map" aria-hidden="true"></div>

    <div class="login-shell">
      <section class="login-panel">
        <div class="panel-head">
          <p class="panel-eyebrow">BZSS PANEL</p>
          <h2>服务器管理面板</h2>
          <p>输入管理账号，进入服务器控制台。</p>
        </div>

        <form @submit.prevent="submit">
          <div class="form-field">
            <label for="username-input" class="field-label">账号</label>
            <input
              id="username-input"
              v-model="username"
              autocomplete="username"
              required
              class="form-input"
              placeholder="请输入账号"
            />
          </div>

          <div class="form-field">
            <label for="password-input" class="field-label">密码</label>
            <div class="password-wrapper">
              <input
                id="password-input"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="form-input password-input"
                placeholder="请输入密码"
              />
              <button
                type="button"
                class="password-toggle"
                @click="togglePasswordVisibility"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              >
                {{ showPassword ? "◐" : "◑" }}
              </button>
            </div>
          </div>

          <label class="remember-row">
            <input v-model="rememberMe" type="checkbox" />
            <span>记住我</span>
          </label>

          <button class="submit-btn" type="submit" :disabled="loading">
            {{ loading ? t("login.loggingIn") : t("login.login") }}
          </button>
        </form>

        <ErrorBlock v-if="errorText" :message="errorText" />

        <div class="login-security-note">
          <span class="security-dot"></span>
          仅限授权管理人员访问
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../app/apiClient";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import { t } from "../i18n";
import { useAuthStore } from "../stores/auth.store";

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
  position: relative;
  overflow: hidden;
  padding: 24px;
  color: #e7eefc;
  background:
    radial-gradient(circle at 18% 22%, rgba(45, 134, 224, 0.18), transparent 22%),
    radial-gradient(circle at 82% 18%, rgba(72, 157, 255, 0.1), transparent 18%),
    radial-gradient(circle at 72% 75%, rgba(255, 165, 180, 0.14), transparent 16%),
    linear-gradient(180deg, #050b16 0%, #07111d 48%, #040812 100%);
}

.login-page--mascot::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(135deg, transparent 0 26%, rgba(80, 158, 255, 0.14) 26% 26.4%, transparent 26.4% 42%, rgba(80, 158, 255, 0.08) 42% 42.35%, transparent 42.35% 100%);
  opacity: 0.35;
}

.login-bg-grid {
  position: absolute;
  inset: 0;
  opacity: 0.15;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.12) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.12) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(circle at center, black 0%, transparent 72%);
  pointer-events: none;
}

.login-bg-map {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 24% 62%, rgba(59, 130, 246, 0.18), transparent 10%),
    radial-gradient(circle at 33% 54%, rgba(59, 130, 246, 0.14), transparent 6%),
    radial-gradient(circle at 43% 46%, rgba(59, 130, 246, 0.1), transparent 8%),
    radial-gradient(circle at 76% 26%, rgba(59, 130, 246, 0.1), transparent 14%);
  opacity: 0.55;
  filter: blur(0.5px);
}

.login-shell {
  position: relative;
  z-index: 1;
  min-height: calc(100vh - 48px);
  width: min(460px, 100%);
  margin: 0 auto;
  display: grid;
  align-items: center;
}

.login-panel {
  padding: 30px 28px 24px;
  border-radius: 24px;
  border: 1px solid rgba(56, 189, 248, 0.18);
  background: rgba(15, 23, 42, 0.68);
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(18px);
}

.panel-head {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
}

.panel-eyebrow {
  margin: 0;
  color: #4fb7ff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.panel-head h2 {
  margin: 0;
  font-size: 30px;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

.panel-head p {
  margin: 0;
  color: rgba(226, 232, 240, 0.72);
  font-size: 14px;
}

.form-field {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
}

.field-label {
  color: rgba(239, 245, 255, 0.9);
  font-size: 14px;
  font-weight: 700;
}

.form-input {
  width: 100%;
  min-width: 0;
  height: 52px;
  border: 1px solid rgba(125, 156, 220, 0.22);
  border-radius: 10px;
  background: rgba(13, 20, 33, 0.72);
  color: #ecf2ff;
  font-size: 16px;
  outline: none;
  padding: 0 14px;
}

.form-input::placeholder {
  color: rgba(231, 238, 252, 0.34);
}

.form-input:focus {
  border-color: rgba(89, 181, 255, 0.5);
  box-shadow: 0 0 0 3px rgba(89, 181, 255, 0.12);
}

.password-wrapper {
  position: relative;
}

.password-input {
  padding-right: 52px;
}

.password-toggle {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgba(230, 239, 255, 0.62);
  font-size: 15px;
}

.remember-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 2px 0 18px;
  color: rgba(231, 238, 252, 0.88);
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.remember-row input {
  width: 18px;
  height: 18px;
  accent-color: #4fb7ff;
}

.submit-btn {
  width: 100%;
  height: 60px;
  border: 0;
  border-radius: 12px;
  background: linear-gradient(180deg, #49b6ff 0%, #2f7fe7 100%);
  color: white;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.06em;
  box-shadow: 0 16px 30px rgba(47, 126, 231, 0.32);
}

.submit-btn:disabled {
  opacity: 0.7;
}

.login-security-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(223, 233, 255, 0.46);
  font-size: 13px;
}

.security-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.5);
}

@media (max-width: 480px) {
  .login-page {
    padding: 16px;
  }

  .login-panel {
    padding: 24px 18px 18px;
  }

  .panel-head h2 {
    font-size: 24px;
  }
}
</style>
