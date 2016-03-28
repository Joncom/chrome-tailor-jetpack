var interval, lastWidth, lastHeight;
interval = setInterval(function() {
    try {
      var body = document.body;
    } catch(e) {
      // "try-catch" because panel.destroy() won't clear interval
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1142446
      clearInterval(interval);
      return;
    }
    if(body === null) {
      return;
    }
    var width = body.offsetWidth;
    var height = body.offsetHeight;
    if(width !== lastWidth || height !== lastHeight) {
      console.log('The body element size changed.');
      self.port.emit("resize", {
        width: width,
        height: height
      });
      lastWidth = width;
      lastHeight = height;
    }
}, 10);