import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import {
  Authenticator,
  ThemeProvider,
  translations,
} from "@aws-amplify/ui-react";
import { I18n } from "aws-amplify/utils";
import "@aws-amplify/ui-react/styles.css";

import { amplifyConfig } from "./config";
import App from "./App";
import "./styles.css";
import "./auth-theme.css";

Amplify.configure(amplifyConfig);

I18n.putVocabularies(translations);
I18n.setLanguage("ja");
I18n.putVocabularies({
  ja: {
    "Sign In": "ログイン",
    "Sign in": "ログイン",
    "Email": "メールアドレス",
    "Password": "パスワード",
    "Forgot your password?": "パスワードをお忘れですか?",
    "Reset Password": "パスワードを再設定",
    "Change Password": "パスワードを変更",
    "Send code": "コードを送信",
  },
});

const theme = {
  name: "ledger-theme",
  tokens: {
    colors: {
      brand: {
        primary: {
          10: "#d9e3da",
          80: "#3f5e4a",
          90: "#324c3b",
          100: "#1f2421",
        },
      },
    },
    fonts: {
      default: { variable: { value: "'Zen Kaku Gothic New', sans-serif" } },
    },
  },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <Authenticator hideSignUp>
        <App />
      </Authenticator>
    </ThemeProvider>
  </React.StrictMode>
);
