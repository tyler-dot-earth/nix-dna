# Nix DNA 🧬

GNOME/Adwaita interface to explore your Nix store, generations, flakes, and configuration.

## Use

```
bin/nix-dna
```

The window has six sections.

1. **Overview.** The machine, the release, the current and booted generations, the store totals, and the disk. A banner stays up while the booted generation is behind the current one.
2. **Generations.** System generations, Home Manager, and the boot entries. Open one for its closure. The diff runs `nix store diff-closures` in the background, and only when you ask.
3. **Packages.** One row per store path behind `/run/current-system/sw/bin`. Search is in the header bar.
4. **Store.** Paths added per day, a treemap of the largest paths, and the list. Click a path for what it needs and what needs it.
5. **Flakes.** The lock of each flake under your home directory, drawn as boxes and lines. A dashed line follows another input's pin. List has the same flakes as rows, plus the registry.
6. **Configuration.** `nix.conf`, the effective config, channels, and the GC roots that are not generations.

It reads. It does not collect garbage, switch a generation, or evaluate a flake.

`nix run` builds the wrapped app instead of using the launcher.

Sizes are NAR bytes, the size Nix recorded. The disk figure is `df` on the filesystem that holds `/nix/store`, so it includes everything else on that disk.
