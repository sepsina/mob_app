
import { Injectable } from '@angular/core';
import { EventsService } from './events.service';
import { UtilsService } from './utils.service';

import * as gConst from './gConst';
import * as gIF from './gIF';

const BRIDGE_TTL = 10;

@Injectable({
    providedIn: 'root',
})
export class UdpService {

    private dgram: any;
    public udpSocket: any;

    private msgBuf = window.nw.Buffer.alloc(1024);
    //private msg: DataView = new DataView(this.msgBuf);

    bridges: gIF.bridge_t[] = [];

    //ipSet = new Set();
    seqNum = 0;

    rdCmd: gIF.rdCmd_t = {
        ip: [],
        busy: false,
        tmoRef: null,
        cmdID: 0,
        idx: 0,
        retryCnt: gConst.RD_CMD_RETRY_CNT,
    };

    rwBuf = new gIF.rwBuf_t();

    constructor(private events: EventsService,
                private utils: UtilsService) {
        this.rwBuf.wrBuf = this.msgBuf;
        this.dgram = window.nw.require('dgram');
        this.udpSocket = this.dgram.createSocket('udp4');
        this.udpSocket.on('message', (msg: any, rinfo: any)=>{
            this.udpOnMsg(msg, rinfo);
        });
        this.udpSocket.on('error', (err: any)=>{
            console.log(`server error:\n${err.stack}`);
        });
        this.udpSocket.on('listening', ()=>{
            let address = this.udpSocket.address();
            console.log(`server listening ${address.address}:${address.port}`);
        });
        this.udpSocket.bind(gConst.UDP_PORT, ()=>{
            this.udpSocket.setBroadcast(true);
        });
        setTimeout(()=>{
            this.cleanAgedBridges();
        }, 1000);
    }

    /***********************************************************************************************
     * fn          udpOnMsg
     *
     * brief
     *
     */
    public udpOnMsg(msg: any, rem: any) {

        this.rwBuf.rdBuf = msg;
        this.rwBuf.rdIdx = 0;

        //let msgBuf = this.utils.bufToArrayBuf(msg);
        //let msgView = new DataView(msgBuf);

        let pktFunc = this.rwBuf.read_uint16_LE();
        switch(pktFunc) {
            case gConst.BRIDGE_ID_RSP: {
                //this.ipSet.add(rem.address);
                this.addBridge(rem.address);
                break;
            }
            case gConst.ON_OFF_ACTUATORS: {
                let startIdx = this.rwBuf.read_uint16_LE();
                let numItems = this.rwBuf.read_uint16_LE();
                let doneFlag = this.rwBuf.read_uint8();
                for(let i = 0; i < numItems; i++) {
                    let item = {} as gIF.onOffItem_t;
                    item.type = gConst.ACTUATOR_ON_OFF;
                    item.partNum = this.rwBuf.read_uint32_LE();
                    item.extAddr = this.rwBuf.read_double_LE();
                    item.endPoint = this.rwBuf.read_uint8();
                    item.state = this.rwBuf.read_uint8();
                    item.level = this.rwBuf.read_uint8();
                    let nameLen = this.rwBuf.read_uint8();
                    let name = [];
                    for(let k = 0; k < nameLen; k++) {
                        name.push(this.rwBuf.read_uint8());
                    }
                    item.name = String.fromCharCode.apply(String, name);
                    item.ip = this.utils.ipFromLong(this.rwBuf.read_uint32_LE());
                    item.port = this.rwBuf.read_uint16_LE();

                    let key = this.itemKey(item.extAddr, item.endPoint);
                    this.events.publish('newItem', {key: key, value: item});
                }
                clearTimeout(this.rdCmd.tmoRef);
                if(doneFlag == 1) {
                    this.rdCmd.ip.shift();
                    if(this.rdCmd.ip.length > 0) {
                        this.rdCmd.idx = 0;
                        this.rdCmd.retryCnt = gConst.RD_CMD_RETRY_CNT;
                        this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
                        this.rdCmd.tmoRef = setTimeout(()=>{
                            this.rdCmdTmo();
                        }, gConst.RD_CMD_TMO);
                    }
                    else {
                        this.rdCmd.busy = false;
                    }
                }
                if(doneFlag == 0) {
                    this.rdCmd.idx = startIdx + numItems;
                    this.rdCmd.retryCnt = gConst.RD_CMD_RETRY_CNT;
                    this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
                    this.rdCmd.tmoRef = setTimeout(()=>{
                        this.rdCmdTmo();
                    }, gConst.RD_CMD_TMO);
                }
                break;
            }
            case gConst.BAT_VOLTS:
            case gConst.P_ATM_SENSORS:
            case gConst.RH_SENSORS:
            case gConst.T_SENSORS: {
                let startIdx = this.rwBuf.read_uint16_LE();
                let numItems = this.rwBuf.read_uint16_LE();
                let doneFlag = this.rwBuf.read_uint8();
                for(let i = 0; i < numItems; i++) {
                    let val: number;
                    let units: number;
                    let item = {} as gIF.sensorItem_t;
                    item.hostIP = rem.address;
                    item.type = gConst.SENSOR;
                    item.partNum = this.rwBuf.read_uint32_LE();
                    item.extAddr = this.rwBuf.read_double_LE();
                    item.endPoint = this.rwBuf.read_uint8();
                    switch(pktFunc) {
                        case gConst.T_SENSORS: {
                            val = this.rwBuf.read_uint16_LE();
                            val = val / 10.0;
                            units = this.rwBuf.read_uint16_LE();
                            if(units == gConst.DEG_F) {
                                item.formatedVal = `${val.toFixed(1)} °F`;
                            }
                            else {
                                item.formatedVal = `${val.toFixed(1)} °C`;
                            }
                            break;
                        }
                        case gConst.RH_SENSORS: {
                            val = this.rwBuf.read_uint16_LE();
                            val = Math.round(val / 10.0);
                            item.formatedVal = `${val.toFixed(0)} %rh`;
                            break;
                        }
                        case gConst.P_ATM_SENSORS: {
                            val = this.rwBuf.read_uint16_LE();
                            val = val / 10.0;
                            units = this.rwBuf.read_uint16_LE();
                            if(units == gConst.IN_HG) {
                                item.formatedVal = `${val.toFixed(1)} inHg`;
                            }
                            else {
                                val = Math.round(val);
                                item.formatedVal = `${val.toFixed(1)} mBar`;
                            }
                            break;
                        }
                        case gConst.BAT_VOLTS: {
                            val = this.rwBuf.read_uint16_LE();
                            val = val / 10.0;
                            item.formatedVal = `${val.toFixed(1)} V`;
                            break;
                        }
                    }
                    let nameLen = this.rwBuf.read_uint8();
                    let name = [];
                    for(let k = 0; k < nameLen; k++) {
                        name.push(this.rwBuf.read_uint8());
                    }
                    item.name = String.fromCharCode.apply(String, name);

                    let key = this.itemKey(item.extAddr, item.endPoint);
                    this.events.publish('newItem', {key: key, value: item});
                }
                clearTimeout(this.rdCmd.tmoRef);
                if(doneFlag == 1) {
                    this.rdCmd.ip.shift();
                    if(this.rdCmd.ip.length > 0) {
                        this.rdCmd.idx = 0;
                        this.rdCmd.retryCnt = gConst.RD_CMD_RETRY_CNT;
                        this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
                        this.rdCmd.tmoRef = setTimeout(()=>{
                            this.rdCmdTmo();
                        }, gConst.RD_CMD_TMO);
                    }
                    else {
                        this.rdCmd.busy = false;
                    }
                }
                if(doneFlag == 0) {
                    this.rdCmd.idx = startIdx + numItems;
                    this.rdCmd.retryCnt = gConst.RD_CMD_RETRY_CNT;
                    this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
                    this.rdCmd.tmoRef = setTimeout(()=>{
                        this.rdCmdTmo();
                    }, gConst.RD_CMD_TMO);
                }
                break;
            }
            case gConst.SL_MSG_ZCL_CMD: {
                const msgSeqNum = this.rwBuf.read_uint8();;
                if(msgSeqNum == this.seqNum){
                    console.log("zcl response");
                }
                break;
            }
            default:
                // ---
                break;
        }
    }

    /***********************************************************************************************
     * fn          readItems
     *
     * brief
     *
     */
    public readItems(cmdID: number) {

        if(this.bridges.length == 0){
            return;
        }
        this.rdCmd.cmdID = cmdID;
        this.rdCmd.busy = true;
        this.rdCmd.ip = [];
        for(let i = 0; i < this.bridges.length; i++){
            this.rdCmd.ip.push(this.bridges[i].ip);
        }

        this.rdCmd.idx = 0;
        this.rdCmd.retryCnt = gConst.RD_CMD_RETRY_CNT;
        this.rdCmd.tmoRef = setTimeout(()=>{
            this.rdCmdTmo();
        }, gConst.RD_CMD_TMO);

        this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
    }

    /***********************************************************************************************
     * fn          getItems
     *
     * brief
     *
     */
    public getItems(ip: string, idx: number) {

        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(this.rdCmd.cmdID);
        this.rwBuf.write_uint16_LE(idx);

        let len = this.rwBuf.wrIdx;
        this.udpSocket.send(this.msgBuf.subarray(0, len), 0, len, gConst.UDP_PORT, ip, (err)=>{
            if(err) {
                console.log('get items err: ' + JSON.stringify(err));
            }
        });
    }

    /***********************************************************************************************
     * fn          rdCmdTmo
     *
     * brief
     *
     */
    rdCmdTmo() {

        console.log('--- READ_CMD_TMO ---');

        if(this.rdCmd.ip.length == 0) {
            this.rdCmd.busy = false;
            return;
        }
        if(this.rdCmd.retryCnt > 0) {
            this.rdCmd.retryCnt--;
            this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
            this.rdCmd.tmoRef = setTimeout(()=>{
                this.rdCmdTmo();
            }, gConst.RD_HOST_TMO);
        }
        if(this.rdCmd.retryCnt == 0) {
            this.rdCmd.ip.shift();
            if(this.rdCmd.ip.length > 0) {
                this.rdCmd.idx = 0;
                this.rdCmd.retryCnt = gConst.RD_CMD_RETRY_CNT;
                this.getItems(this.rdCmd.ip[0], this.rdCmd.idx);
                this.rdCmd.tmoRef = setTimeout(()=>{
                    this.rdCmdTmo();
                }, gConst.RD_CMD_TMO);
            }
            else {
                this.rdCmd.busy = false;
            }
        }
    }

    /***********************************************************************************************
     * fn          itemKey
     *
     * brief
     *
     */
    private itemKey(extAddr: number, endPoint: number) {

        const len = 8 + 1;
        const ab = new ArrayBuffer(len);
        const dv = new DataView(ab);
        let i = 0;
        dv.setFloat64(i, extAddr, gConst.LE);
        i += 8;
        dv.setUint8(i++, endPoint);
        let key = [];
        for (let i = 0; i < len; i++) {
            key[i] = dv.getUint8(i).toString(16);
        }
        return `item-${key.join('')}`;
    }

    /***********************************************************************************************
     * fn          addBridge
     *
     * brief
     *
     */
    private addBridge(ip: string) {

        let newFlag = true;
        let i = this.bridges.length;
        if(i > 0){
            while(i--){
                if(this.bridges[i].ip == ip){
                    this.bridges[i].ttl = BRIDGE_TTL;
                    newFlag = false;
                }
            }
        }
        if(newFlag == true){
            const newBridge = {
                ip: ip,
                ttl: BRIDGE_TTL
            };
            this.bridges.push(newBridge);
        }
    }

    /***********************************************************************************************
     * fn          cleanAgedBridges
     *
     * brief
     *
     */
    private cleanAgedBridges() {

        let i = this.bridges.length;
        if(i > 0){
            while(i--){
                if(this.bridges[i].ttl > 0){
                    this.bridges[i].ttl--;
                }
                else {
                    this.bridges.splice(i, 1);
                }
            }
        }
        setTimeout(()=>{
            this.cleanAgedBridges();
        }, 1000);
    }
}
