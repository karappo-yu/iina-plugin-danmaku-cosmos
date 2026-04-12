const {
  standaloneWindow,
  overlay,
  sidebar,
  event,
  console,
  menu,
} = iina;

console.log("Plugin is running");

standaloneWindow.loadFile("dist/ui/window/index.html");

menu.addItem(
  menu.item("Show Window", () => {
    standaloneWindow.open();
  }),
);

event.on("iina.window-loaded", () => {
  overlay.loadFile("dist/ui/overlay/index.html");

  menu.addItem(
    menu.item("Show Video Overlay", () => {
      overlay.show()
    }),
  );
  menu.addItem(
    menu.item("Hide Video Overlay", () => {
      overlay.hide()
    }),
  );
});

event.on("iina.window-loaded", () => {
  sidebar.loadFile("dist/ui/sidebar/index.html");
});