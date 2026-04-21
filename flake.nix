{
  description = "SAP CAP Capstone Project – NixOS Dev Shell";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          name = "sap-cap-dev";

          packages = with pkgs; [
            # --- Runtime ---
            nodejs_20   # SAP CAP requires Node 18+; LTS 20 is the safe pick

            # --- CAP local DB (default profile uses SQLite) ---
            sqlite

            # --- Handy tooling ---
            git
            curl
            jq          # useful for inspecting CAP's metadata JSON / OData responses
          ];

          shellHook = ''
            # ── npm global prefix ─────────────────────────────────────────────
            # NixOS's store is read-only, so "npm install -g" needs a writable
            # prefix.  We put it in ~/.npm-global, which persists across shells.
            export NPM_CONFIG_PREFIX="$HOME/.npm-global"
            export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
            mkdir -p "$NPM_CONFIG_PREFIX"

            # ── Install @sap/cds-dk (once) ────────────────────────────────────
            if ! command -v cds &>/dev/null; then
              echo "⏳  First run: installing @sap/cds-dk …"
              npm install -g @sap/cds-dk
              echo "✅  cds-dk installed"
            fi

            # ── Install local project deps if needed ──────────────────────────
            if [ -f package.json ] && [ ! -d node_modules ]; then
              echo "⏳  Running npm install …"
              npm install
            fi

            # ── Greeting ──────────────────────────────────────────────────────
            echo ""
            echo "╔══════════════════════════════════════╗"
            echo "║  SAP CAP Dev Shell ready             ║"
            echo "╠══════════════════════════════════════╣"
            printf  "║  node  %-30s║\n" "$(node  --version)"
            printf  "║  npm   %-30s║\n" "$(npm   --version)"
            printf  "║  cds   %-30s║\n" "$(cds   --version 2>/dev/null | head -1)"
            echo "╠══════════════════════════════════════╣"
            echo "║  Quick commands:                     ║"
            echo "║    cds init <name>   – new project   ║"
            echo "║    cds watch         – run + reload  ║"
            echo "║    cds deploy        – deploy to DB  ║"
            echo "╚══════════════════════════════════════╝"
            echo ""
          '';
        };
      });
}
