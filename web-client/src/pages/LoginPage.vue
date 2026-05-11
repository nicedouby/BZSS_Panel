<template>
  <main class="login-page">
    <section class="login-panel">
      <div>
        <h1>BZSS Panel</h1>
        <p>登录后进入控制台。</p>
      </div>

      <form @submit.prevent="submit">
        <label>
          <span>Username</span>
          <input v-model="username" autocomplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit" :disabled="loading">{{ loading ? "登录中..." : "登录" }}</button>
      </form>

      <ErrorBlock v-if="errorText" :message="errorText" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { ApiError } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import ErrorBlock from "../components/common/ErrorBlock.vue";

const router = useRouter();
const auth = useAuthStore();

const username = ref("DoubyBear");
const password = ref("DoubyBear");
const loading = ref(false);
const localError = ref("");
const errorText = computed(() => localError.value || auth.error || "");

async function submit() {
  loading.value = true;
  localError.value = "";
  try {
    await auth.login(username.value, password.value);
    await router.replace("/match-status");
  } catch (error: any) {
    if (error instanceof ApiError) {
      localError.value = error.status === 401 ? "用户名或密码错误。" : error.message;
    } else {
      localError.value = error?.message ?? "登录失败。";
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #101317;
}

.login-panel {
  width: min(420px, 100%);
  display: grid;
  gap: 18px;
  border: 1px solid #2c343d;
  background: #151a20;
  border-radius: 8px;
  padding: 22px;
}

h1 {
  margin: 0;
  font-size: 24px;
}

p {
  margin: 6px 0 0;
  color: #9aa7b2;
}

form {
  display: grid;
  gap: 12px;
}

label {
  display: grid;
  gap: 6px;
}

label span {
  color: #9aa7b2;
  font-size: 12px;
}

input {
  width: 100%;
  border: 1px solid #34404b;
  background: #10161c;
  color: #edf2f4;
  border-radius: 6px;
  padding: 10px 11px;
}
</style>
