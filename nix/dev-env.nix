# Prints shell exports for the unpackaged launcher.
# Reads the nixpkgs pin from ../flake.nix so the dev shell and the package agree.
let
  flake = builtins.getFlake (toString ../.);
  system = builtins.currentSystem;
  pkgs = flake.inputs.nixpkgs.legacyPackages.${system};
  typelibDirs = [
    "${pkgs.glib.out}/lib/girepository-1.0"
    "${pkgs.gobject-introspection}/lib/girepository-1.0"
    "${pkgs.gtk4}/lib/girepository-1.0"
    "${pkgs.libadwaita}/lib/girepository-1.0"
    "${pkgs.pango.out}/lib/girepository-1.0"
    "${pkgs.graphene}/lib/girepository-1.0"
    "${pkgs.gdk-pixbuf}/lib/girepository-1.0"
    "${pkgs.harfbuzz.out}/lib/girepository-1.0"
    "${pkgs.gjs}/lib/gjs/girepository-1.0"
  ];
  dataDirs = [
    "${pkgs.adwaita-icon-theme}/share"
    "${pkgs.hicolor-icon-theme}/share"
    "${pkgs.gtk4}/share"
    "${pkgs.libadwaita}/share"
    "${pkgs.glib.out}/share"
  ];
  join = builtins.concatStringsSep ":";
in
''
  export ABOUT_NIX_GJS=${pkgs.gjs}/bin/gjs
  export ABOUT_NIX_SQLITE=${pkgs.sqlite}/bin/sqlite3
  export GI_TYPELIB_PATH=${join typelibDirs}''${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}
  export XDG_DATA_DIRS=${join dataDirs}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}
''
