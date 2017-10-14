var inherits = require('util').inherits;
var SerialPort = require("serialport");
var RFLink = require('./rflink');
var Service, Characteristic;
var debug = process.env.hasOwnProperty('RFLINK_DEBUG') ? consoleDebug : function () {};

function consoleDebug() {
      console.log.apply(this, arguments);
}


module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerPlatform("homebridge-rflink", "RFLink", RFLinkPlatform);
};

//
// RFLink Platform
//
function RFLinkPlatform(log, config) {
  this.log = log;
  this.config = config;
}

RFLinkPlatform.prototype.accessories = function(callback) {
  var foundDevices = [];

  if (this.config.bridges) {

    var bridgesLength = this.config.bridges.length;

    if (bridgesLength === 0) {
      this.log("ERROR: No bridges found in configuration.");
      return;
    } else {
      for (var i = 0; i < bridgesLength; i++) {
        if ( !! this.config.bridges[i]) {
          returnedDevices = this._addDevices(this.config.bridges[i]);
          foundDevices.push.apply(foundDevices, returnedDevices);
          returnedDevices = null;
        }
      }
    }
  } else {
    this.log("ERROR: Could not read any bridges from configuration.");
    return;
  }

  if (foundDevices.length > 0) {
    callback(foundDevices);
  } else {
    this.log("ERROR: Unable to find any valid devices.");
    return;
  }
};

RFLinkPlatform.prototype._addDevices = function(bridgeConfig) {
  var devices = [];
  var devicesLength = 0;
  // Various error checking
  if (!bridgeConfig.devices || (devicesLength = bridgeConfig.devices.length) === 0) {
    this.log("ERROR: Could not read devices from configuration.");
    return;
  }

  // Initialize a new controller to be used for all zones defined for this bridge
  // We interface the bridge directly via serial port
  bridgeController = new RFLink({
    device: bridgeConfig.serialport || false,
    baudrate: bridgeConfig.baudrate || false,
    delayBetweenCommands: bridgeConfig.delay || false,
    commandRepeat: bridgeConfig.repeat || false
  },
  this._dataHandler.bind(this));

  // Create accessories for all of the defined devices
  for (var i = 0; i < devicesLength; i++) {
    if ( !! bridgeConfig.devices[i]) {
      dev = new RFLinkAccessory(this.log, bridgeConfig.devices[i], bridgeController);
      if (dev) {
        devices.push(dev);
      }
    }
  }
  this._devices = devices;
  return devices;
};

RFLinkPlatform.prototype._dataHandler = function(data) {
  data = data.split(';');
  if (data.length > 5) {
    data[3] = (data[3]!==undefined)?data[3].split('=').pop():null;
    //data[3] = data[3].length < 6 ? "0".repeat(6-data[3].length) + data[3] : data[3];
    data[4] = (data[4]!==undefined)?data[4].split('=').pop():null;

    var packet = {
      type: data[0],
      id: data[1],
      protocol: data[2],
      address: data[3],
      channel: data[4],
      command: data[5]
    };

    this._devices.forEach(function (device) {
      device.parsePacket(packet);
    });
  }
};

//
// RFLink Accessory
//
function RFLinkAccessory(log, config, controller) {
  this.log = log;
  this.config = config;
  this.controller = controller;
  this.name = config.name;
  this.type = config.type;
  this.protocol = config.protocol;
  this.address = config.address;
  this.channels = config.channels;
  this.services = Array();

  var i = 0;
  // Add homekit service types
  this.channels.forEach(function (chn) {
    var channel;
    if (chn.hasOwnProperty('channel')) {
      channel = chn;
    } else {
      channel = { channel: chn };
    }

    if (channel.name === undefined) {
      channel.name = this.name + ' ' + channel.channel;
//      if (channel.type == "StatelessProgrammableSwitch") {
//        channel.name = channel.name + ' ' + channel.command;
//      }
    }
    if (channel.type === undefined) {
      channel.type = this.type;
    }

      service = new Service[channel.type](channel.name, i);
      service.channel = channel.channel;
      service.type = channel.type;
      service.name = channel.name;
      service.device = this;
      service.lastCommand = '';
      service.parsePacket = this.parsePacket[channel.type];

      // if channel is of writable type
      if (service.type == 'Lightbulb' || service.type == 'Switch') {
        service.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(service));
      }

      // Set command if StatelessProgrammableSwitch
//      if(service.type == 'StatelessProgrammableSwitch') {
//        service.command = channel.command;
//      }

      // Add brightness Characteristic if dimrange option is set
      if (channel.dimrange) {
        service.addCharacteristic(new Characteristic.Brightness())
          .on('set', this.setBrightness.bind(service));
        service.dimrange = channel.dimrange;
      }


      // add to services stack
      this.services.push(service);
      i++;
  }.bind(this));


  // Set device information
  this.informationService = new Service.AccessoryInformation();
  this.informationService
    .setCharacteristic(Characteristic.Manufacturer, "RFLink")
    .setCharacteristic(Characteristic.Model, this.protocol)
    .setCharacteristic(Characteristic.SoftwareRevision, require('./package.json').version)
    .setCharacteristic(Characteristic.Version, require('./package.json').version);

  this.log("Added RFLink device: %s, protocol: %s, address: %s, channels: %d", this.name, this.protocol, this.address, this.channels.length);

}

RFLinkAccessory.prototype.getServices = function() {
  return this.services.concat(this.informationService);
};


RFLinkAccessory.prototype.setOn = function(on, callback, context) {
  if (context !== 'RFLink') {
    var cmd = '10;' +
        this.device.protocol + ';' +
        this.device.address + ';' +
        this.channel + (on?";ON;\n":";OFF;\n");

    if (cmd != this.lastCommand) {
      this.device.controller.sendCommands(cmd);
      this.lastCommand = cmd;
      //    this.device.log("Channel: %s, switched: %d, by command: %s", this.channel, on, cmd);
    }

  }

  return callback(null);
};

RFLinkAccessory.prototype.setBrightness = function(brightness, callback, context) {
  if (context !== 'RFLink') {
    brightnessScaled = Math.round(brightness * this.dimrange / 100);
    var cmd = '10;' +
        this.device.protocol + ';' +
        this.device.address + ';' +
        this.channel + ';' +
        brightnessScaled + ';\n';

    if (cmd != this.lastCommand) {
        this.device.controller.sendCommands(cmd);
        this.lastCommand = cmd;
    }

    if (brightness === 0) {
      this.getCharacteristic(Characteristic.On).setValue(0, false, 'RFLink');
    } else {
      this.getCharacteristic(Characteristic.On).setValue(1, false, 'RFLink');
    }
    debug("Channel: %s, brightness: %d, by command: %s", this.channel, brightness, cmd);
  }
  return callback(null);
};

RFLinkAccessory.prototype.parsePacket = function(packet) {
  if (packet.protocol == this.protocol && packet.address == this.address) {
    this.services.forEach(function (service) {
      service.parsePacket(packet);
    });
  }
};

RFLinkAccessory.prototype.parsePacket.Lightbulb = function (packet) {
  if(packet.channel == this.channel) {
    debug("%s: Matched channel: %s, command: %s", this.type, packet.channel, packet.command);
    if (packet.command == 'CMD=ON') {
      this.getCharacteristic(Characteristic.On).setValue(1, false, 'RFLink');
    } else if (packet.command == 'CMD=OFF') {
      this.getCharacteristic(Characteristic.On).setValue(0, false, 'RFLink');
    }
  }
};

RFLinkAccessory.prototype.parsePacket.Switch = RFLinkAccessory.prototype.parsePacket.Lightbulb;

RFLinkAccessory.prototype.parsePacket.StatefulProgrammableSwitch = function(packet) {
  if(packet.channel == this.channel) {
    debug("%s: Matched channel: %s, command: %s", this.type, packet.channel, packet.command);
    if (packet.command == 'CMD=ON') {
      this.getCharacteristic(Characteristic.ProgrammableSwitchOutputState).setValue(1, false, 'RFLink');
      this.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, false, 'RFLink');
    } else if (packet.command == 'CMD=OFF') {
      this.getCharacteristic(Characteristic.ProgrammableSwitchOutputState).setValue(0, false, 'RFLink');
      this.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, false, 'RFLink');
    }
  }
};

RFLinkAccessory.prototype.parsePacket.StatelessProgrammableSwitch = function(packet) {
    if(packet.channel == this.channel) {
      debug("%s: Matched channel: %s, command: %s", this.type, packet.channel, packet.command);
      if (packet.command == 'CMD=ON'){
        this.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, false, 'RFLink');
      } else if (packet.command == 'CMD=OFF') {
        this.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS, false, 'RFLink');
      }
    } else if (this.channel == "all") {
      if (packet.command == 'CMD=ALLON'){
        this.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, false, 'RFLink');
      } else if (packet.command == 'CMD=ALLOFF') {
        this.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setValue(Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS, false, 'RFLink');
      }
    }
};
