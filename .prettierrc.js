module.exports = {
  apps: [
    {
      resolve: "prettier",
      use: {
        semi: true,
        singleQuote: false,
        tabWidth: 2,
        trailingComma: "es5",
        printWidth: 100,
      },
    },
  ],
};
