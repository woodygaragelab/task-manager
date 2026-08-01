// sam deploy 後に表示される Outputs の値をここに反映してください。
//   UserPoolId       -> userPoolId
//   UserPoolClientId -> userPoolClientId
//   WebApiEndpoint    -> apiBaseUrl(末尾にスラッシュは付けない)
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: "ap-northeast-1_HbqJsbWyS",
      userPoolClientId: "3d7teaagegsidv8ke6ih7bf7od",
    },
  },
};

export const API_BASE_URL =
  "https://kvwrqkhd29.execute-api.ap-northeast-1.amazonaws.com";
