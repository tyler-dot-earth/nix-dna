{
  description = "Nix DNA, a libadwaita browser for this machine";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/c5ae371";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.callPackage ./nix/nix-dna-package.nix { };
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/nix-dna";
        };
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              gjs
              gtk4
              libadwaita
              gobject-introspection
              wrapGAppsHook4
              sqlite
            ];
          };
        }
      );
    };
}
