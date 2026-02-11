import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeaturesaddedComponent } from './featuresadded.component';

describe('FeaturesaddedComponent', () => {
  let component: FeaturesaddedComponent;
  let fixture: ComponentFixture<FeaturesaddedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FeaturesaddedComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(FeaturesaddedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
