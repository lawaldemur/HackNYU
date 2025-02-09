const webpack = require("webpack");

module.exports = function override(config) {
    config.resolve.fallback = {
        ...config.resolve.fallback,
        https: require.resolve("https-browserify"),
        zlib: require.resolve("browserify-zlib"),
        http: require.resolve("stream-http"),
        stream: require.resolve("stream-browserify"),
        crypto: require.resolve("crypto-browserify"),
    };
    return config;
};
