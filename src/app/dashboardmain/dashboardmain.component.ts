import { Component } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-dashboardmain',
  templateUrl: './dashboardmain.component.html',
  styleUrls: ['./dashboardmain.component.css']
})
export class DashboardmainComponent {

  fields: string[] = [
    'Country',
    'Region',
    'Category',
    'Sales',
    'Profit',
    'Quantity'
  ];

  columns: string[] = [];
  rows: string[] = [];

  drop(event: CdkDragDrop<string[]>) {

    const source = event.previousContainer;
    const target = event.container;

    if (source === target) {
      moveItemInArray(
        target.data,
        event.previousIndex,
        event.currentIndex
      );
      return;
    }

    if (source.id === 'fieldsList' && target.id !== 'fieldsList') {
      const value = source.data[event.previousIndex];

      if (target.data.includes(value)) {
        return;
      }

      target.data.splice(event.currentIndex, 0, value);
      return;
    }
    return;
  }

  remove(list: string[], index: number) {
    list.splice(index, 1);
  }
}
