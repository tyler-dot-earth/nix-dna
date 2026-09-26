{
  stdenvNoCC,
  lib,
  gjs,
  gtk4,
  libadwaita,
  glib,
  pango,
  graphene,
  gdk-pixbuf,
  harfbuzz,
  gobject-introspection,
  wrapGAppsHook4,
  sqlite,
  adwaita-icon-theme,
  hicolor-icon-theme,
  nix-icons ? null,
}:

stdenvNoCC.mkDerivation {
  pname = "nix-dna";
  version = "0.1.0";

  src = ../.;

  nativeBuildInputs = [
    wrapGAppsHook4
    gobject-introspection
  ];

  buildInputs = [
    gjs
    gtk4
    libadwaita
    glib
    pango
    graphene
    gdk-pixbuf
    harfbuzz
    adwaita-icon-theme
    hicolor-icon-theme
  ]
  ++ lib.optional (nix-icons != null) nix-icons;

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/nix-dna $out/bin $out/share/applications $out/share/icons/hicolor/scalable/apps
    cp -r src/nix-dna $out/share/nix-dna/src
    cp data/org.nixos.NixDna.desktop $out/share/applications/
    cp data/org.nixos.NixDna.svg $out/share/icons/hicolor/scalable/apps/org.nixos.NixDna.svg
    cat > $out/bin/nix-dna << 'EOF'
    #!/usr/bin/env bash
    set -euo pipefail
    exec @gjs@/bin/gjs -m @out@/share/nix-dna/src/main.js "$@"
    EOF
    substituteInPlace $out/bin/nix-dna \
      --replace-fail @gjs@ ${gjs} \
      --replace-fail @out@ $out
    chmod +x $out/bin/nix-dna
    runHook postInstall
  '';

  preFixup = ''
    gappsWrapperArgs+=(
      --prefix PATH : ${lib.makeBinPath [ sqlite ]}
      --set ABOUT_NIX_SQLITE ${sqlite}/bin/sqlite3
    )
  '';

  meta = {
    description = "Adwaita browser for the Nix store, generations, flakes, and configuration on this machine";
    homepage = "https://nixos.org/";
    license = lib.licenses.mit;
    mainProgram = "nix-dna";
    platforms = lib.platforms.linux;
  };
}
