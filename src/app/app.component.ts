import {Component, OnInit, OnDestroy, NgZone} from '@angular/core';
import { EventsService } from './events.service';
import { UdpService } from './udp.service';
//import { Validators, FormControl } from '@angular/forms';

import * as gConst from './gConst';
//import * as gIF from './gIF';

const NO_SEL = 0;
const T_SENS = 1;
const RH_SENS = 2;
const ON_OFF_ACT = 3;

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy{

    selectedType = NO_SEL;
    g_const = gConst;

    udpBusy = false;
    itemsMap = new Map();

    constructor(public udp: UdpService,
                public events: EventsService,
                public ngZone: NgZone) {
        // ---
    }

    /***********************************************************************************************
     * fn          ngOnInit
     *
     * brief
     *
     */
    ngOnInit() {

        this.udpBusy = this.udp.rdCmd.busy;
        this.udp.itemsRef = this.itemsMap;

        this.events.subscribe('newItem', (msg)=>{
            this.ngZone.run(()=>{
                this.itemsMap.set(msg.key, msg.value);
            });
        });
        window.onbeforeunload = ()=>{
            this.ngOnDestroy();
        };
        setTimeout(()=>{
            this.readSelected();
        }, 100);

    }

    /***********************************************************************************************
     * fn          ngOnDestroy
     *
     * brief
     *
     */
    ngOnDestroy() {
        this.udp.udpSocket.close();
    }

     /***********************************************************************************************
     * @fn          readSelected
     *
     * @brief
     *
     */
    readSelected(){

        if(this.udpBusy == true){
            return;
        }

        this.itemsMap.clear();

        switch(this.selectedType){
            case ON_OFF_ACT: {
                this.udp.readItems(gConst.ON_OFF_ACTUATORS);
                break;
            }
            case T_SENS: {
                this.udp.readItems(gConst.T_SENSORS);
                break;
            }
            case RH_SENS: {
                this.udp.readItems(gConst.RH_SENSORS);
                break;
            }
            default:
                break;
        }
    }

    /***********************************************************************************************
     * @fn          getSelDesc
     *
     * @brief
     *
     */
    getSelDesc(){

        let desc = '- - -';

        switch(this.selectedType){
            case ON_OFF_ACT: {
                desc = 'on-off actuators';
                break;
            }
            case T_SENS: {
                desc = 'temperature';
                break;
            }
            case RH_SENS: {
                desc = 'humidity';
                break;
            }
            default:
                break;
        }
        return desc;
    }

    /***********************************************************************************************
     * @fn          selTemp
     *
     * @brief
     *
     */
    selTemp(){
        this.selectedType = T_SENS;
        this.readSelected();
    }
    /***********************************************************************************************
     * @fn          selRH
     *
     * @brief
     *
     */
    selRH(){
        this.selectedType = RH_SENS;
        this.readSelected();
    }
    /***********************************************************************************************
     * @fn          selOnOffAct
     *
     * @brief
     *
     */
    selOnOffAct(){
        this.selectedType = ON_OFF_ACT;
        this.readSelected();
    }

}
