{
  description = "ScamBox - środowisko deweloperskie (Rust + Supabase CLI)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, flake-utils, rust-overlay, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ (import rust-overlay) ];
        };

        # najnowszy stabilny Rust (nix flake update = nowsza wersja)
        rust = pkgs.rust-bin.stable.latest.default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
        };

        # Supabase CLI prosto z wydań GitHub - nixpkgs bywa kilka wersji w tyle.
        # Aktualizacja: nowa wersja + sumy z checksums.txt wydania.
        supabaseVersion = "2.122.0";
        supabaseRelease = {
          x86_64-linux = { arch = "linux_amd64"; sha256 = "59ed066847b98d7461c60e9109d40cab6b9756177ce06ebb05b51338519f5136"; };
          aarch64-linux = { arch = "linux_arm64"; sha256 = "8980b46044aba0863f26a1b4134a498d2c74df0dadf24289bb4faa86729511cc"; };
          x86_64-darwin = { arch = "darwin_amd64"; sha256 = "8be7d5bb00091e67618d12fb0a4a1bb10624c69435ecd5b9b95d91d571cc34d8"; };
          aarch64-darwin = { arch = "darwin_arm64"; sha256 = "fe87a5f9781d5423dbd5ebba2d5a6e1a541d01754d14941c574952e5695eaab0"; };
        }.${system};
        supabase-cli = pkgs.stdenvNoCC.mkDerivation {
          pname = "supabase-cli";
          version = supabaseVersion;
          src = pkgs.fetchurl {
            url = "https://github.com/supabase/cli/releases/download/v${supabaseVersion}/supabase_${supabaseVersion}_${supabaseRelease.arch}.tar.gz";
            inherit (supabaseRelease) sha256;
          };
          sourceRoot = ".";
          installPhase = "install -Dm755 supabase $out/bin/supabase";
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            rust
            pkgs.sqlx-cli
            supabase-cli
            pkgs.postgresql
          ];
        };
      });
}
