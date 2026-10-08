if (Session.get()) {
  window.location.href = APP_CONFIG.ROUTES.home;
}

const userInput = document.getElementById("login-user");
const passInput = document.getElementById("login-pass");
const passToggle = document.getElementById("toggle-pass");
const errorBox = document.getElementById("login-error");
const form = document.getElementById("login-form");
const submitBtn = document.getElementById("login-submit");

passToggle.addEventListener("click", () => {
  const isHidden = passInput.type === "password";
  passInput.type = isHidden ? "text" : "password";
  passToggle.textContent = isHidden ? "Sembunyi" : "Lihat";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.classList.add("hidden");
  submitBtn.disabled = true;

  try {
    const result = await AuthService.login(userInput.value.trim().toLowerCase(), passInput.value.trim());
    Session.save({ user: result.user, role: result.role, token: result.token, loginAt: new Date().toISOString() });
    window.location.href = APP_CONFIG.ROUTES.home;
  } catch (error) {
    errorBox.textContent = error.status === 0 ? "Server tidak dapat dihubungi." : "Username atau password tidak valid.";
    errorBox.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
  }
});
